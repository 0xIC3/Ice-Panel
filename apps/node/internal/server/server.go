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
