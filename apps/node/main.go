package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/payload"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/server"
)

const (
	defaultPort = "8443"
	defaultHost = "0.0.0.0"
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

	srv, err := server.New(server.Config{
		Host:    getenv("NODE_HOST", defaultHost),
		Port:    getenv("NODE_PORT", defaultPort),
		Payload: pld,
		Logger:  logger,
	})
	if err != nil {
		logger.Error("build server", "err", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := srv.Run(ctx); err != nil {
		logger.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
