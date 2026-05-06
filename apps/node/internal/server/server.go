// Package server hosts the node-agent's mTLS HTTPS server. It dispatches
// `addUser` / `removeUser` / `getStats` calls to every registered CoreAdapter.
package server

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/dto"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/payload"
)

type Config struct {
	Host    string
	Port    string
	Payload *payload.Payload
	Logger  *slog.Logger
	// Adapters is the ordered list of registered cores. The dispatcher fans
	// AddUser / RemoveUser out to all of them and merges Stats. May be empty
	// (callback-only mode).
	Adapters []core.CoreAdapter
	// InboundsStorePath is where /applyInbounds persists the latest pushed
	// state to disk so it survives node-agent restarts. Default
	// `/etc/ice-panel-node/inbounds.json`. Empty means in-memory only
	// (used in tests).
	InboundsStorePath string
}

type Server struct {
	cfg       Config
	logger    *slog.Logger
	startedAt time.Time
}

func New(cfg Config) (*Server, error) {
	if cfg.Logger == nil {
		return nil, errors.New("logger is required")
	}
	if cfg.Payload == nil {
		return nil, errors.New("payload is required")
	}
	return &Server{cfg: cfg, logger: cfg.Logger}, nil
}

// Run starts the HTTPS server and blocks until ctx is cancelled or it errors.
// On cancellation it gracefully shuts down with a 5s deadline.
func (s *Server) Run(ctx context.Context) error {
	s.startedAt = time.Now()

	cert, err := tls.X509KeyPair(
		[]byte(s.cfg.Payload.NodeCertPem),
		[]byte(s.cfg.Payload.NodeKeyPem),
	)
	if err != nil {
		return fmt.Errorf("load node keypair: %w", err)
	}

	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM([]byte(s.cfg.Payload.CACertPem)) {
		return errors.New("invalid CA pem in payload")
	}

	httpSrv := &http.Server{
		Addr:    s.cfg.Host + ":" + s.cfg.Port,
		Handler: s.routes(),
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			ClientCAs:    caPool,
			ClientAuth:   tls.RequireAndVerifyClientCert,
			MinVersion:   tls.VersionTLS12,
		},
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		s.logger.Info("listening", "addr", httpSrv.Addr)
		err := httpSrv.ListenAndServeTLS("", "")
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		s.logger.Info("shutdown signal received")
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return httpSrv.Shutdown(shutCtx)
	case err := <-errCh:
		return err
	}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/addUser", s.handleAddUser)
	mux.HandleFunc("/removeUser", s.handleRemoveUser)
	mux.HandleFunc("/applyInbounds", s.handleApplyInbounds)
	mux.HandleFunc("/stats", s.handleStats)
	return mux
}

// ───── Handlers ─────

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	cores := make([]dto.CoreStatus, 0, len(s.cfg.Adapters))
	allHealthy := true
	for _, adapter := range s.cfg.Adapters {
		running := adapter.Healthy()
		if !running {
			allHealthy = false
		}
		cores = append(cores, dto.CoreStatus{
			Name:    dto.ProtocolName(adapter.Name()),
			Running: running,
		})
	}
	status := "ok"
	if !allHealthy {
		status = "degraded"
	}
	writeJSON(w, http.StatusOK, dto.HealthcheckResponse{Status: status, Cores: cores})
}

func (s *Server) handleAddUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST only")
		return
	}
	var req dto.AddUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}

	coreUser := core.User{
		UserID:             req.UserID,
		ShortID:            req.ShortID,
		Username:           req.Username,
		HysteriaPassword:   req.Credentials.HysteriaPassword,
		XrayUUID:           req.Credentials.XrayUUID,
		NaivePassword:      req.Credentials.NaivePassword,
		AmneziaWGPublicKey: req.Credentials.AmneziaWGPublicKey,
		AmneziaWGAllowedIP: req.Credentials.AmneziaWGAllowedIP,
	}

	var failed []string
	for _, adapter := range s.cfg.Adapters {
		if err := adapter.AddUser(coreUser); err != nil {
			s.logger.Error("adapter addUser failed", "core", adapter.Name(), "err", err)
			failed = append(failed, adapter.Name())
		}
	}
	if len(failed) > 0 {
		writeError(w, http.StatusInternalServerError, "ADAPTER_FAILED",
			fmt.Sprintf("adapters failed: %s", strings.Join(failed, ", ")))
		return
	}

	s.logger.Info("addUser ok", "userId", req.UserID, "username", req.Username)
	writeJSON(w, http.StatusOK, dto.AddUserResponse{OK: true})
}

func (s *Server) handleRemoveUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST only")
		return
	}
	var req dto.RemoveUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}

	var failed []string
	for _, adapter := range s.cfg.Adapters {
		if err := adapter.RemoveUser(req.UserID); err != nil {
			s.logger.Error("adapter removeUser failed", "core", adapter.Name(), "err", err)
			failed = append(failed, adapter.Name())
		}
	}
	if len(failed) > 0 {
		writeError(w, http.StatusInternalServerError, "ADAPTER_FAILED",
			fmt.Sprintf("adapters failed: %s", strings.Join(failed, ", ")))
		return
	}

	s.logger.Info("removeUser ok", "userId", req.UserID)
	writeJSON(w, http.StatusOK, dto.RemoveUserResponse{OK: true})
}

// handleApplyInbounds receives the panel's full inbound set for this node
// and persists it to disk so the next node-agent / adapter restart picks it
// up. Slice 24 v1 — minimal version: persists + logs, no per-protocol live
// reconfiguration yet (that's per-adapter follow-up work). Idempotent: the
// `applied` / `skipped` counters in the response always reflect "everything
// was overwritten", so the panel can use it as a generic ack.
func (s *Server) handleApplyInbounds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST only")
		return
	}
	var req dto.ApplyInboundsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return
	}

	if s.cfg.InboundsStorePath != "" {
		if err := writeInboundsAtomically(s.cfg.InboundsStorePath, req.Inbounds); err != nil {
			s.logger.Error("persist inbounds failed", "err", err, "path", s.cfg.InboundsStorePath)
			writeError(w, http.StatusInternalServerError, "PERSIST_FAILED", err.Error())
			return
		}
	}

	// Dispatch each inbound to the matching adapter by protocol name. Adapters
	// that don't recognise the protocol return nil (defensive no-op contract).
	// Slice 24b — Xray has a real reconfig impl; the others are stubs that
	// log and rely on the persisted inbounds.json for next-restart pickup.
	applied := 0
	failed := 0
	for _, ib := range req.Inbounds {
		s.logger.Info("applyInbounds received",
			"id", ib.ID, "name", ib.Name, "protocol", ib.Protocol, "port", ib.Port)

		var matched core.CoreAdapter
		for _, adapter := range s.cfg.Adapters {
			if adapter.Name() == string(ib.Protocol) {
				matched = adapter
				break
			}
		}
		if matched == nil {
			s.logger.Warn("applyInbounds: no adapter for protocol — config persisted but not applied live",
				"protocol", ib.Protocol)
			continue
		}
		if err := matched.ApplyInbound(ib.Config); err != nil {
			s.logger.Error("adapter ApplyInbound failed",
				"core", matched.Name(), "inboundId", ib.ID, "err", err)
			failed++
			continue
		}
		applied++
	}

	if failed > 0 {
		writeError(w, http.StatusInternalServerError, "ADAPTER_FAILED",
			fmt.Sprintf("%d/%d inbounds failed to apply", failed, len(req.Inbounds)))
		return
	}

	writeJSON(w, http.StatusOK, dto.ApplyInboundsResponse{
		OK:      true,
		Applied: applied,
		Skipped: len(req.Inbounds) - applied,
	})
}

// writeInboundsAtomically marshals the inbound set to a temp file in the same
// directory, then renames it over the destination — so a crash mid-write
// can't leave the JSON half-overwritten. Mode 0600 because the configs may
// embed REALITY private keys / WireGuard server keys.
func writeInboundsAtomically(path string, inbounds []dto.InboundDto) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}

	body, err := json.MarshalIndent(inbounds, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	tmp, err := os.CreateTemp(dir, ".inbounds.*.json.tmp")
	if err != nil {
		return fmt.Errorf("tempfile: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op if rename succeeded

	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write: %w", err)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("chmod: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	return nil
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	allUsers := []dto.UserStats{}
	var totalIn, totalOut int64
	for _, adapter := range s.cfg.Adapters {
		stats, err := adapter.GetStats()
		if err != nil {
			s.logger.Error("adapter getStats failed", "core", adapter.Name(), "err", err)
			continue
		}
		for _, u := range stats.Users {
			allUsers = append(allUsers, dto.UserStats{
				UserID:   u.UserID,
				BytesIn:  u.BytesIn,
				BytesOut: u.BytesOut,
			})
		}
		totalIn += stats.TotalBytesIn
		totalOut += stats.TotalBytesOut
	}
	uptime := int64(time.Since(s.startedAt).Seconds())
	writeJSON(w, http.StatusOK, dto.GetStatsResponse{
		Users:         allUsers,
		Uptime:        uptime,
		TotalBytesIn:  totalIn,
		TotalBytesOut: totalOut,
	})
}

// ───── Helpers ─────

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, dto.ErrorResponse{Error: code, Message: msg})
}
