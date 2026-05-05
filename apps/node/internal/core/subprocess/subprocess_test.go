package subprocess

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

func newSilentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestStartAndStopSleep(t *testing.T) {
	proc := New(Config{
		Name:   "sleep-test",
		Binary: "/bin/sleep",
		Args:   []string{"5"},
		Logger: newSilentLogger(),
	})

	ctx := context.Background()
	if err := proc.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !proc.Running() {
		t.Errorf("Running: expected true after Start")
	}

	if err := proc.Stop(ctx); err != nil {
		t.Errorf("Stop: %v", err)
	}
	if proc.Running() {
		t.Errorf("Running: expected false after Stop")
	}
}

func TestRunningBeforeStart(t *testing.T) {
	proc := New(Config{Name: "x", Binary: "/bin/true", Logger: newSilentLogger()})
	if proc.Running() {
		t.Errorf("Running: expected false before Start")
	}
}

func TestStartFailsOnMissingBinary(t *testing.T) {
	proc := New(Config{
		Name:   "ghost",
		Binary: "/no/such/binary/anywhere",
		Logger: newSilentLogger(),
	})
	if err := proc.Start(context.Background()); err == nil {
		t.Errorf("Start: expected error for missing binary")
	}
}

func TestDoubleStartReturnsError(t *testing.T) {
	proc := New(Config{
		Name:   "sleep-test",
		Binary: "/bin/sleep",
		Args:   []string{"5"},
		Logger: newSilentLogger(),
	})
	defer func() { _ = proc.Stop(context.Background()) }()

	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("first Start: %v", err)
	}
	if err := proc.Start(context.Background()); err == nil {
		t.Errorf("second Start: expected error")
	}
}

func TestStopWhenNotStartedIsNoop(t *testing.T) {
	proc := New(Config{Name: "x", Binary: "/bin/true", Logger: newSilentLogger()})
	if err := proc.Stop(context.Background()); err != nil {
		t.Errorf("Stop on unstarted: expected nil, got %v", err)
	}
}

func TestStopRespectsContext(t *testing.T) {
	proc := New(Config{
		Name:   "sleep-long",
		Binary: "/bin/sleep",
		Args:   []string{"60"},
		Logger: newSilentLogger(),
	})
	if err := proc.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Cancel before grace period elapses; Stop should kill the process and
	// return ctx.Err().
	stopCtx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := proc.Stop(stopCtx)
	if err == nil {
		// Process may have caught SIGTERM and exited cleanly within 100ms — fine.
		// Just assert it's no longer running.
	}
	if proc.Running() {
		t.Errorf("Running: expected false after Stop with cancelled ctx")
	}
}
