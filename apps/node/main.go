package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/core/hysteria"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/core/xray"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/payload"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/server"
)

const (
	defaultPort                = "8443"
	defaultHost                = "0.0.0.0"
	defaultAuthCallbackPort    = 9000
	defaultXrayPort            = 443
	defaultXrayConfigPath      = "/etc/xray/config.json"
	defaultXrayRealityDest     = "www.cloudflare.com:443"
	defaultXrayRealitySNI      = "www.cloudflare.com"
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
	adapters := []core.CoreAdapter{
		hysteria.New(hysteria.Config{
			AuthCallbackHost: getenv("HYSTERIA_AUTH_HOST", "127.0.0.1"),
			AuthCallbackPort: getenvInt("HYSTERIA_AUTH_PORT", defaultAuthCallbackPort),
			BinaryPath:       os.Getenv("HYSTERIA_BINARY"),
			ConfigPath:       os.Getenv("HYSTERIA_CONFIG"),
		}, logger),
	}

	// Xray adapter is opt-in: registered only when XRAY_REALITY_PRIVATE_KEY
	// is set. Without REALITY private key the inbound config is invalid, so
	// the adapter would fail to Start anyway — better to skip cleanly.
	if cfg, ok := buildXrayConfig(); ok {
		adapters = append(adapters, xray.New(cfg, logger))
		logger.Info("xray adapter enabled")
	}

	return adapters
}

func buildXrayConfig() (xray.Config, bool) {
	privateKey := os.Getenv("XRAY_REALITY_PRIVATE_KEY")
	if privateKey == "" {
		return xray.Config{}, false
	}
	shortIDs := splitCSV(os.Getenv("XRAY_REALITY_SHORT_IDS"))
	serverNames := splitCSV(getenv("XRAY_REALITY_SERVER_NAMES", defaultXrayRealitySNI))

	return xray.Config{
		BinaryPath: os.Getenv("XRAY_BINARY"),
		ConfigPath: getenv("XRAY_CONFIG", defaultXrayConfigPath),
		Inbound: xray.InboundConfig{
			ListenPort:         getenvInt("XRAY_PORT", defaultXrayPort),
			RealityDest:        getenv("XRAY_REALITY_DEST", defaultXrayRealityDest),
			RealityServerNames: serverNames,
			RealityPrivateKey:  privateKey,
			RealityShortIDs:    shortIDs,
		},
	}, true
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
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
