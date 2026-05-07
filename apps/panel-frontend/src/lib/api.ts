import axios, { type AxiosError } from 'axios';
import { useAuth } from '../stores/auth';

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request when we have one.
api.interceptors.request.use((config) => {
  const token = useAuth.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401 the token is bad/expired — clear the session so the next render
// kicks the user back to /login.
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      useAuth.getState().clearSession();
    }
    return Promise.reject(err);
  },
);

// ───── Typed helpers for the endpoints we know about ─────

export interface AuthStatusResponse {
  authentication: { password: { enabled: boolean } };
  registration: { enabled: boolean };
}

export interface LoginResponse {
  admin: { id: string; username: string; role: string; createdAt: string; updatedAt: string };
  token: string;
}

export interface RegisterResponse {
  id: string;
  username: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const { data } = await api.get<AuthStatusResponse>('/api/auth/status');
  return data;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/api/auth/login', { username, password });
  return data;
}

export async function register(username: string, password: string): Promise<RegisterResponse> {
  const { data } = await api.post<RegisterResponse>('/api/auth/register', { username, password });
  return data;
}

// ───── Users ─────

export type TrafficLimitStrategy = 'no_reset' | 'day' | 'week' | 'month' | 'rolling';

export type ProtocolName =
  | 'hysteria'
  | 'xray'
  | 'amneziawg'
  | 'naive'
  | 'shadowsocks'
  | 'mtproto'
  | 'mieru';

export type ShadowsocksMethod =
  | '2022-blake3-aes-128-gcm'
  | '2022-blake3-aes-256-gcm'
  | '2022-blake3-chacha20-poly1305'
  | 'chacha20-ietf-poly1305'
  | 'aes-256-gcm'
  | 'aes-128-gcm';

export interface ShadowsocksInboundConfig {
  method: ShadowsocksMethod;
}

export interface MtprotoInboundConfig {
  domain: string;
}

export interface MieruInboundConfig {
  mtu: number;
}

export interface User {
  id: string;
  shortId: string;
  username: string;
  status: string;
  expireAt: string | null;
  trafficLimitBytes: number | null;
  trafficUsedBytes: number;
  lifetimeTrafficBytes: number;
  trafficLimitStrategy: TrafficLimitStrategy;
  lastTrafficResetAt: string | null;
  lastOnlineAt: string | null;
  subscriptionToken: string;
  subRevokedAt: string | null;
  hwidDeviceLimit: number | null;
  description: string | null;
  tag: string | null;
  telegramId: string | null;
  email: string | null;
  enabledProtocols: ProtocolName[];
  /** Slice 26 — squads the user belongs to. Always includes ALL_SQUAD_ID. */
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UsersListResponse {
  users: User[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateUserInput {
  username: string;
  expireDays?: number | null;
  trafficLimitGb?: number | null;
  trafficLimitStrategy?: TrafficLimitStrategy;
  description?: string | null;
  tag?: string | null;
  email?: string | null;
  telegramId?: string | null;
  hwidDeviceLimit?: number | null;
  enabledProtocols?: ProtocolName[];
  /** Slice 26 — squad membership. Empty/undefined → backend auto-adds to All. */
  groupIds?: string[];
}

export interface UpdateUserInput {
  status?: 'active' | 'disabled';
  trafficLimitGb?: number | null;
  trafficLimitStrategy?: TrafficLimitStrategy;
  expireAt?: string | null;
  description?: string | null;
  tag?: string | null;
  email?: string | null;
  telegramId?: string | null;
  hwidDeviceLimit?: number | null;
  enabledProtocols?: ProtocolName[];
  /** Slice 26 — replaces the full squad set when provided. */
  groupIds?: string[];
}

export async function listUsers(params?: {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}): Promise<UsersListResponse> {
  const { data } = await api.get<UsersListResponse>('/api/users', { params });
  return data;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const { data } = await api.post<User>('/api/users', input);
  return data;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  const { data } = await api.put<User>(`/api/users/${id}`, input);
  return data;
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/api/users/${id}`);
}

/** Helper to build a copy-pasteable subscription URL for a user. */
export function subscriptionUrl(token: string): string {
  return `${API_BASE_URL}/sub/${token}`;
}

// ───── Nodes ─────

export type NodeProtocol =
  | 'xray'
  | 'hysteria'
  | 'amneziawg'
  | 'naive'
  | 'shadowsocks'
  | 'mtproto'
  | 'mieru';

export interface Node {
  id: string;
  name: string;
  address: string;
  protocol: NodeProtocol;
  countryCode: string | null;
  status: string;
  lastStatusChange: string | null;
  lastStatusMessage: string | null;
  consumptionMultiplier: string;
  createdAt: string;
  updatedAt: string;
}

export interface BootstrapInfo {
  /** Single-use token (URL-safe, ~32 chars). Survives the 4 KB TTY paste limit. */
  token: string;
  /** ISO timestamp when the token stops being redeemable. */
  expiresAt: string;
  /** Pre-rendered single-line install command, ready to copy-paste on the node. */
  command: string;
}

/** The create response carries the one-time payload + a bootstrap token. */
export interface NodeWithPayload extends Node {
  payload: string;
  bootstrap: BootstrapInfo;
}

export async function refreshNodeBootstrap(id: string): Promise<BootstrapInfo> {
  const { data } = await api.post<BootstrapInfo>(`/api/nodes/${id}/bootstrap`);
  return data;
}

export interface NodesListResponse {
  nodes: Node[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateNodeInput {
  name: string;
  address: string;
  protocol: NodeProtocol;
  countryCode?: string | null;
  consumptionMultiplier?: number;
}

export interface UpdateNodeInput {
  name?: string;
  address?: string;
  protocol?: NodeProtocol;
  countryCode?: string | null;
  consumptionMultiplier?: number;
}

export async function listNodes(params?: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<NodesListResponse> {
  const { data } = await api.get<NodesListResponse>('/api/nodes', { params });
  return data;
}

export async function createNode(input: CreateNodeInput): Promise<NodeWithPayload> {
  const { data } = await api.post<NodeWithPayload>('/api/nodes', input);
  return data;
}

export async function updateNode(id: string, input: UpdateNodeInput): Promise<Node> {
  const { data } = await api.put<Node>(`/api/nodes/${id}`, input);
  return data;
}

export async function deleteNode(id: string): Promise<void> {
  await api.delete(`/api/nodes/${id}`);
}

// ───── Subscription Response Rules (SRR) ─────

export type SubscriptionFormat = 'plain' | 'json' | 'clash' | 'singbox' | 'wgconf' | 'xrayjson';

export interface SrrRule {
  id: string;
  name: string;
  uaPattern: string;
  format: SubscriptionFormat;
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSrrInput {
  name: string;
  uaPattern: string;
  format: SubscriptionFormat;
  priority?: number;
  enabled?: boolean;
}

export interface UpdateSrrInput {
  name?: string;
  uaPattern?: string;
  format?: SubscriptionFormat;
  priority?: number;
  enabled?: boolean;
}

export interface TestSrrResponse {
  /** null when no rule matched. */
  format: SubscriptionFormat | null;
  userAgent: string;
}

export async function listSrrRules(): Promise<{ rules: SrrRule[] }> {
  const { data } = await api.get<{ rules: SrrRule[] }>('/api/srr');
  return data;
}

export async function createSrrRule(input: CreateSrrInput): Promise<SrrRule> {
  const { data } = await api.post<SrrRule>('/api/srr', input);
  return data;
}

export async function updateSrrRule(id: string, input: UpdateSrrInput): Promise<SrrRule> {
  const { data } = await api.put<SrrRule>(`/api/srr/${id}`, input);
  return data;
}

export async function deleteSrrRule(id: string): Promise<void> {
  await api.delete(`/api/srr/${id}`);
}

// ───── Inbounds ─────

export interface HysteriaInboundConfig {
  obfsPassword?: string;
  masqueradeUrl?: string;
  brutalUpMbps?: number;
  brutalDownMbps?: number;
}

export type XrayNetwork = 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';

export interface XrayInboundConfig {
  realityDest: string;
  realityServerNames: string[];
  realityShortIds: string[];
  realityPrivateKey: string;
  realityPublicKey: string;
  flow?: string;
  fingerprint?: string;
  network?: XrayNetwork;
  path?: string;
  host?: string;
  serviceName?: string;
  /** Slice 24c part 3 — `vless` (default) or `trojan` over the same REALITY
   *  stack. Empty/undefined → server falls back to vless. */
  subprotocol?: 'vless' | 'trojan';
}

export interface AmneziawgObfuscation {
  jc: number;
  jmin: number;
  jmax: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
}

export interface AmneziawgInboundConfig {
  subnet: string;
  serverPrivateKey: string;
  serverPublicKey: string;
  obfuscation: AmneziawgObfuscation;
}

export interface NaiveInboundConfig {
  hostname: string;
  tlsEmail: string;
  masqueradeRoot: string;
}

export type InboundConfig =
  | HysteriaInboundConfig
  | XrayInboundConfig
  | AmneziawgInboundConfig
  | NaiveInboundConfig
  | ShadowsocksInboundConfig
  | MtprotoInboundConfig
  | MieruInboundConfig;

export interface Inbound {
  id: string;
  nodeId: string;
  protocol: ProtocolName;
  name: string;
  port: number;
  /** Override of the public host emitted in client URIs. NULL → fall back
   *  to `node.address`. Slice 25 — separates control-plane endpoint from
   *  client-facing FQDN. */
  publicHost: string | null;
  /** Override of the public port. NULL → use `port`. */
  publicPort: number | null;
  config: InboundConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInboundInput {
  nodeId: string;
  protocol: ProtocolName;
  name: string;
  port: number;
  enabled?: boolean;
  publicHost?: string;
  publicPort?: number;
  config: InboundConfig;
}

export interface UpdateInboundInput {
  name?: string;
  port?: number;
  enabled?: boolean;
  /** `null` clears the override, `undefined` keeps the current value. */
  publicHost?: string | null;
  publicPort?: number | null;
  config?: InboundConfig;
}

export async function listInbounds(): Promise<{ inbounds: Inbound[] }> {
  const { data } = await api.get<{ inbounds: Inbound[] }>('/api/inbounds');
  return data;
}

export async function createInbound(input: CreateInboundInput): Promise<Inbound> {
  const { data } = await api.post<Inbound>('/api/inbounds', input);
  return data;
}

export async function updateInbound(id: string, input: UpdateInboundInput): Promise<Inbound> {
  const { data } = await api.put<Inbound>(`/api/inbounds/${id}`, input);
  return data;
}

export async function deleteInbound(id: string): Promise<void> {
  await api.delete(`/api/inbounds/${id}`);
}

export interface KeypairResponse {
  privateKey: string;
  publicKey: string;
}

/** Generate a fresh x25519 keypair for REALITY / AmneziaWG inbound.
 *  Same crypto, different alphabet: `xray` returns base64url (REALITY
 *  validator rejects standard base64), `amneziawg` returns standard base64. */
export async function generateInboundKeypair(
  protocol: 'xray' | 'amneziawg' = 'amneziawg',
): Promise<KeypairResponse> {
  const { data } = await api.post<KeypairResponse>(
    `/api/inbounds/generate-keypair?protocol=${protocol}`,
  );
  return data;
}

export async function testSrrRule(userAgent: string): Promise<TestSrrResponse> {
  const { data } = await api.post<TestSrrResponse>('/api/srr/test', { userAgent });
  return data;
}

// ───── Squads (slice 26) ─────

/** Stable, well-known UUID of the system "All" squad. Mirrored from
 *  apps/panel-backend/src/modules/squads/squads.constants.ts — UI uses it
 *  to render the row as read-only (rename/delete is rejected backend-side). */
export const ALL_SQUAD_ID = '00000000-0000-0000-0000-000000000001';

export interface Squad {
  id: string;
  name: string;
  description: string | null;
  /** Slice 27 — squad ACL is profile-level. Renamed from inboundIds. */
  profileIds: string[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSquadInput {
  name: string;
  description?: string | null;
  profileIds?: string[];
}

export interface UpdateSquadInput {
  name?: string;
  description?: string | null;
  /** Replaces the full profile set when provided. */
  profileIds?: string[];
}

export async function listSquads(): Promise<{ squads: Squad[] }> {
  const { data } = await api.get<{ squads: Squad[] }>('/api/squads');
  return data;
}

export async function createSquad(input: CreateSquadInput): Promise<Squad> {
  const { data } = await api.post<Squad>('/api/squads', input);
  return data;
}

export async function updateSquad(id: string, input: UpdateSquadInput): Promise<Squad> {
  const { data } = await api.put<Squad>(`/api/squads/${id}`, input);
  return data;
}

export async function deleteSquad(id: string): Promise<void> {
  await api.delete(`/api/squads/${id}`);
}

// ───── Profiles + Bindings (slice 27) ─────
//
// Replaces the per-node Inbound model. A Profile is a logical inbound
// template (shared across nodes), a Binding deploys it to a specific node
// with optional per-node overrides.

export interface Profile {
  id: string;
  name: string;
  protocol: ProtocolName;
  description: string | null;
  config: InboundConfig;
  enabled: boolean;
  bindingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Binding {
  id: string;
  profileId: string;
  nodeId: string;
  port: number;
  publicHost: string | null;
  publicPort: number | null;
  overrides: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileInput {
  name: string;
  protocol: ProtocolName;
  description?: string | null;
  config: InboundConfig;
  enabled?: boolean;
}

export interface UpdateProfileInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  config?: InboundConfig;
}

export interface CreateBindingInput {
  profileId: string;
  nodeId: string;
  port: number;
  publicHost?: string;
  publicPort?: number;
  overrides?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateBindingInput {
  port?: number;
  publicHost?: string | null;
  publicPort?: number | null;
  overrides?: Record<string, unknown> | null;
  enabled?: boolean;
}

export async function listProfiles(params?: {
  protocol?: ProtocolName;
}): Promise<{ profiles: Profile[] }> {
  const { data } = await api.get<{ profiles: Profile[] }>('/api/profiles', { params });
  return data;
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  const { data } = await api.post<Profile>('/api/profiles', input);
  return data;
}

export async function updateProfile(id: string, input: UpdateProfileInput): Promise<Profile> {
  const { data } = await api.put<Profile>(`/api/profiles/${id}`, input);
  return data;
}

export async function deleteProfile(id: string): Promise<void> {
  await api.delete(`/api/profiles/${id}`);
}

export async function listBindings(params?: {
  nodeId?: string;
  profileId?: string;
}): Promise<{ bindings: Binding[] }> {
  const { data } = await api.get<{ bindings: Binding[] }>('/api/bindings', { params });
  return data;
}

export async function createBinding(input: CreateBindingInput): Promise<Binding> {
  const { data } = await api.post<Binding>('/api/bindings', input);
  return data;
}

export async function updateBinding(id: string, input: UpdateBindingInput): Promise<Binding> {
  const { data } = await api.put<Binding>(`/api/bindings/${id}`, input);
  return data;
}

export async function deleteBinding(id: string): Promise<void> {
  await api.delete(`/api/bindings/${id}`);
}

// ───── Dashboard ─────

export interface NodeHostMetrics {
  cpu: {
    usagePercent: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    cores: number;
  };
  memory: {
    totalBytes: number;
    availableBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  disk: {
    path: string;
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  uptimeSeconds: number;
  collectedAt: string;
}

export interface DashboardOverview {
  users: {
    total: number;
    byStatus: Record<string, number>;
    onlineNow: number;
    onlineToday: number;
    onlineThisWeek: number;
    neverOnline: number;
  };
  traffic: {
    todayBytes: number;
    yesterdayBytes: number;
    last7dBytes: number;
    last30dBytes: number;
    calendarMonthBytes: number;
    currentYearBytes: number;
    last24hHourly: { hour: string; bytes: number }[];
  };
  system: {
    onlineNodeCount: number;
    totalNodeCount: number;
  };
  host: {
    cpu: {
      loadPercent: number | null;
      samplePercent: number;
      cores: number;
      loadavg: [number, number, number];
    };
    memory: { totalBytes: number; usedBytes: number; usedPercent: number };
    disk: {
      totalBytes: number;
      usedBytes: number;
      usedPercent: number;
      path: string;
    } | null;
    process: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      uptimeSeconds: number;
    };
  };
  nodes: {
    id: string;
    name: string;
    address: string;
    protocol: string;
    status: string;
    countryCode: string | null;
    lastStatusChange: string | null;
    inboundCount: number;
    todayBytes: number;
    metrics: NodeHostMetrics | null;
  }[];
  byProtocol: {
    protocol: string;
    inboundCount: number;
    enabledUserCount: number;
  }[];
  topUsersToday: { id: string; username: string; bytes: number }[];
  recentEvents: {
    id: string;
    eventType: string;
    userId: string;
    username: string | null;
    createdAt: string;
  }[];
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const { data } = await api.get<DashboardOverview>('/api/dashboard/overview');
  return data;
}
