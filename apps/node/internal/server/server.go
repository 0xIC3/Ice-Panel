// Package server hosts the node-agent's mTLS HTTPS server. Slice 10 keeps
// the handlers as stubs; slice 11 will dispatch them through the CoreAdapter
// interface to drive real proxy-core processes (Hysteria first).
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
	"time"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/dto"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/payload"
)

type Config struct {
	Host    string
	Port    string
	Payload *payload.Payload
	Logger  *slog.Logger
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
		// Cert+key are already in TLSConfig — pass empty paths.
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

// ───── Handlers (stubs — slice 11 wires them to CoreAdapter) ─────

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	writeJSON(w, http.StatusOK, dto.HealthcheckResponse{
		Status: "ok",
		Cores:  []dto.CoreStatus{},
	})
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
	s.logger.Info("addUser stub",
		"userId", req.UserID, "username", req.Username,
	)
	// TODO slice 11: dispatch to CoreAdapter for each enabled protocol.
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
	s.logger.Info("removeUser stub", "userId", req.UserID)
	writeJSON(w, http.StatusOK, dto.RemoveUserResponse{OK: true})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	uptime := int64(time.Since(s.startedAt).Seconds())
	writeJSON(w, http.StatusOK, dto.GetStatsResponse{
		Users:         []dto.UserStats{},
		Uptime:        uptime,
		TotalBytesIn:  0,
		TotalBytesOut: 0,
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
