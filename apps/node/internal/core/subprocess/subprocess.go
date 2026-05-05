// Package subprocess wraps `os/exec` for proxy-core binaries: it adds
// log-streaming to slog, a graceful Stop with SIGTERM-then-SIGKILL deadline,
// and a `Running()` query. Hysteria, Xray, NaiveProxy adapters all spawn an
// upstream binary — this package is the shared lifecycle manager.
package subprocess

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// StopGracePeriod is how long Stop waits for the process to exit after SIGTERM
// before escalating to SIGKILL.
const StopGracePeriod = 5 * time.Second

type Config struct {
	// Name appears in log lines (`source=<name>`) and error messages.
	Name string
	// Binary is the absolute path to the executable.
	Binary string
	// Args are passed verbatim after the binary name.
	Args []string
	// Logger receives one entry per line of stdout/stderr (Info/Error level).
	Logger *slog.Logger
}

// Subprocess is a single managed os/exec process. Methods are goroutine-safe.
type Subprocess struct {
	cfg Config

	mu  sync.Mutex
	cmd *exec.Cmd
}

// New builds a Subprocess; nothing is spawned until Start is called.
func New(cfg Config) *Subprocess {
	return &Subprocess{cfg: cfg}
}

// Start spawns the process. Stdout/stderr are streamed line-by-line into the
// configured logger. Returns an error if the binary cannot be exec'd.
//
// Returns an error if Start has already been called and Stop hasn't.
func (s *Subprocess) Start(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd != nil {
		return fmt.Errorf("%s: already started", s.cfg.Name)
	}

	cmd := exec.CommandContext(ctx, s.cfg.Binary, s.cfg.Args...)
	cmd.Stdout = newLogWriter(s.cfg.Logger, slog.LevelInfo, s.cfg.Name)
	cmd.Stderr = newLogWriter(s.cfg.Logger, slog.LevelError, s.cfg.Name)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn %s: %w", s.cfg.Name, err)
	}
	s.cmd = cmd
	s.cfg.Logger.Info(s.cfg.Name+" subprocess started", "pid", cmd.Process.Pid)
	return nil
}

// Stop gracefully terminates the process: SIGTERM, wait up to StopGracePeriod
// or until ctx is cancelled, then SIGKILL. Returns nil if the process exited
// cleanly within the grace window.
func (s *Subprocess) Stop(ctx context.Context) error {
	s.mu.Lock()
	cmd := s.cmd
	s.cmd = nil
	s.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return nil
	}

	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		s.cfg.Logger.Warn("sigterm failed", "name", s.cfg.Name, "err", err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	select {
	case <-done:
		return nil
	case <-time.After(StopGracePeriod):
		_ = cmd.Process.Kill()
		return fmt.Errorf("%s did not stop within %s, killed", s.cfg.Name, StopGracePeriod)
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		return ctx.Err()
	}
}

// Running reports whether the process has been started and has not exited.
func (s *Subprocess) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd == nil || s.cmd.Process == nil {
		return false
	}
	return s.cmd.ProcessState == nil
}

// ───── log-line writer (moved from hysteria/adapter.go) ─────

func newLogWriter(logger *slog.Logger, level slog.Level, source string) io.Writer {
	return &logWriter{logger: logger, level: level, source: source}
}

type logWriter struct {
	logger *slog.Logger
	level  slog.Level
	source string
	mu     sync.Mutex
	buf    []byte
}

func (w *logWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	for {
		idx := indexNewline(w.buf)
		if idx < 0 {
			break
		}
		line := string(w.buf[:idx])
		w.buf = w.buf[idx+1:]
		w.logger.Log(context.Background(), w.level, line, "source", w.source)
	}
	return len(p), nil
}

func indexNewline(b []byte) int {
	for i, c := range b {
		if c == '\n' {
			return i
		}
	}
	return -1
}

// Sentinel for callers that want to assert "no error AND was running".
var ErrNotStarted = errors.New("subprocess not started")
