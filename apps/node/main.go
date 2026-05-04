package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/core/hysteria"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/payload"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/server"
)

const (
	defaultPort                = "8443"
	defaultHost                = "0.0.0.0"
	defaultAuthCallbackPort    = 9000
	adapterStopShutdownTimeout = 10 * time.Second
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	payloadEnv := os.Getenv("NODE_PAYLOAD")
	if payloadEnv == "" {
		logger.Error("NODE_PAYLOAD env is required")
		os.Exit(1)
	}

	pld, err := payload.Decode(payloadEnv)
	if err != nil {
		logger.Error("decode payload", "err", err)
		os.Exit(1)
	}

	adapters := buildAdapters(logger)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Start every adapter before the HTTPS server — we want auth callbacks
	// listening before any addUser request can arrive.
	for _, a := range adapters {
		if err := a.Start(ctx); err != nil {
			logger.Error("start adapter", "name", a.Name(), "err", err)
			stopAdapters(adapters, logger)
			os.Exit(1)
		}
	}

	srv, err := server.New(server.Config{
		Host:     getenv("NODE_HOST", defaultHost),
		Port:     getenv("NODE_PORT", defaultPort),
		Payload:  pld,
		Logger:   logger,
		Adapters: adapters,
	})
	if err != nil {
		logger.Error("build server", "err", err)
		stopAdapters(adapters, logger)
		os.Exit(1)
	}

	if err := srv.Run(ctx); err != nil {
		logger.Error("server exited with error", "err", err)
	}

	stopAdapters(adapters, logger)
}

func buildAdapters(logger *slog.Logger) []core.CoreAdapter {
	hys := hysteria.New(hysteria.Config{
		AuthCallbackHost: getenv("HYSTERIA_AUTH_HOST", "127.0.0.1"),
		AuthCallbackPort: getenvInt("HYSTERIA_AUTH_PORT", defaultAuthCallbackPort),
		BinaryPath:       os.Getenv("HYSTERIA_BINARY"),
		ConfigPath:       os.Getenv("HYSTERIA_CONFIG"),
	}, logger)
	return []core.CoreAdapter{hys}
}

func stopAdapters(adapters []core.CoreAdapter, logger *slog.Logger) {
	stopCtx, cancel := context.WithTimeout(context.Background(), adapterStopShutdownTimeout)
	defer cancel()
	for _, a := range adapters {
		if err := a.Stop(stopCtx); err != nil {
			logger.Error("stop adapter", "name", a.Name(), "err", err)
		}
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
