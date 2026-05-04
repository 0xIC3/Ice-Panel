package core

import "context"

// CoreAdapter is the central abstraction of Ice-Panel: every proxy core wraps
// behind this interface, which lets the dispatcher treat them uniformly.
//
// Implementations live in `internal/core/<protocol>/` and are registered
// from main at startup based on which protocols the node is configured for.
//
// Contract notes:
//   - All methods are expected to be goroutine-safe.
//   - `AddUser` and `RemoveUser` MUST be idempotent — the panel may retry
//     a job after a partial failure, so re-applying the same operation is
//     a no-op.
//   - `Start` blocks only long enough to launch the underlying binary; it
//     does NOT wait for the binary to be ready to accept traffic. Use
//     `GetStats` polling or a healthcheck for readiness.
type CoreAdapter interface {
	// Name returns the protocol identifier (matches dto.ProtocolName).
	Name() string

	// Start launches the underlying core (subprocess, in-process server, ...).
	// Returning nil means the launch was initiated; readiness is asynchronous.
	Start(ctx context.Context) error

	// Stop gracefully terminates the core. Implementations should respect a
	// shutdown deadline (~5s) and force-kill on timeout.
	Stop(ctx context.Context) error

	// AddUser registers a user with the core. Idempotent.
	AddUser(user User) error

	// RemoveUser unregisters a user by id. Idempotent.
	RemoveUser(userID string) error

	// GetStats returns the latest traffic counters known to the core.
	GetStats() (*Stats, error)
}
