// Package dto contains JSON wire-format structs for the panel↔node API.
// Field names match the TypeScript DTOs in `packages/shared/src/transport.ts`.
package dto

// ProtocolName mirrors the union in shared/transport.ts.
type ProtocolName string

const (
	ProtocolHysteria  ProtocolName = "hysteria"
	ProtocolXray      ProtocolName = "xray"
	ProtocolAmneziaWG ProtocolName = "amneziawg"
	ProtocolNaive     ProtocolName = "naive"
)

type ProtocolCredentials struct {
	HysteriaPassword   string `json:"hysteriaPassword,omitempty"`
	XrayUUID           string `json:"xrayUuid,omitempty"`
	NaivePassword      string `json:"naivePassword,omitempty"`
	AmneziaWGPublicKey string `json:"amneziawgPublicKey,omitempty"`
	// AmneziaWGAllowedIP is the IP the panel allocated for this user inside
	// the inbound's subnet (e.g. "10.0.0.42"). The adapter writes it into
	// the peer block as `<ip>/32`. Only present when the user has access to
	// an amneziawg inbound.
	AmneziaWGAllowedIP string `json:"amneziawgAllowedIp,omitempty"`
}

// ───── POST /addUser ─────

type AddUserRequest struct {
	UserID      string              `json:"userId"`
	ShortID     string              `json:"shortId"`
	Username    string              `json:"username"`
	Credentials ProtocolCredentials `json:"credentials"`
}

type AddUserResponse struct {
	OK bool `json:"ok"`
}

// ───── POST /removeUser ─────

type RemoveUserRequest struct {
	UserID string `json:"userId"`
}

type RemoveUserResponse struct {
	OK bool `json:"ok"`
}

// ───── GET /stats ─────

type UserStats struct {
	UserID   string `json:"userId"`
	BytesIn  int64  `json:"bytesIn"`
	BytesOut int64  `json:"bytesOut"`
}

type GetStatsResponse struct {
	Users         []UserStats `json:"users"`
	Uptime        int64       `json:"uptime"`
	TotalBytesIn  int64       `json:"totalBytesIn"`
	TotalBytesOut int64       `json:"totalBytesOut"`
}

// ───── GET /healthz ─────

type CoreStatus struct {
	Name    ProtocolName `json:"name"`
	Running bool         `json:"running"`
}

type HealthcheckResponse struct {
	Status string       `json:"status"`
	Cores  []CoreStatus `json:"cores"`
}

// ───── Common error shape ─────

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}
