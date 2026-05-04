/**
 * DTOs for the panel→node REST+mTLS API.
 *
 * These types are the wire-format contract. The Go node-agent reimplements
 * matching structs with json tags; the panel-backend imports them directly.
 *
 * Byte counts are typed as `number` for ergonomics — values comfortably fit
 * in a JS double for any realistic single-period traffic. Lifetime totals
 * may eventually need string encoding; revisit when quotas exceed ~8 PB.
 */

export type ProtocolName = 'hysteria' | 'xray' | 'amneziawg' | 'naive';

export interface ProtocolCredentials {
  hysteriaPassword?: string;
  xrayUuid?: string;
  naivePassword?: string;
  amneziawgPublicKey?: string;
}

// ───── POST /addUser ─────

export interface AddUserRequest {
  userId: string;
  shortId: string;
  username: string;
  credentials: ProtocolCredentials;
}

export interface AddUserResponse {
  ok: true;
}

// ───── POST /removeUser ─────

export interface RemoveUserRequest {
  userId: string;
}

export interface RemoveUserResponse {
  ok: true;
}

// ───── GET /stats ─────

export interface UserStats {
  userId: string;
  bytesIn: number;
  bytesOut: number;
}

export interface GetStatsResponse {
  /** Per-user counters since the last poll. */
  users: UserStats[];
  /** Node uptime in seconds. */
  uptime: number;
  totalBytesIn: number;
  totalBytesOut: number;
}

// ───── GET /healthz ─────

export interface CoreStatus {
  name: ProtocolName;
  running: boolean;
}

export interface HealthcheckResponse {
  status: 'ok' | 'degraded';
  cores: CoreStatus[];
}

// ───── Common error shape ─────

export interface NodeErrorResponse {
  error: string;
  message: string;
}
