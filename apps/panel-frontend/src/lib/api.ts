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

export type ProtocolName = 'hysteria' | 'xray' | 'amneziawg' | 'naive';

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
  subscriptionToken: string;
  subRevokedAt: string | null;
  hwidDeviceLimit: number | null;
  description: string | null;
  tag: string | null;
  telegramId: string | null;
  email: string | null;
  enabledProtocols: ProtocolName[];
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
  enabledProtocols?: ProtocolName[];
}

export interface UpdateUserInput {
  status?: 'active' | 'disabled';
  trafficLimitGb?: number | null;
  trafficLimitStrategy?: TrafficLimitStrategy;
  expireAt?: string | null;
  description?: string | null;
  tag?: string | null;
  email?: string | null;
  enabledProtocols?: ProtocolName[];
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

export interface Node {
  id: string;
  name: string;
  address: string;
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
  countryCode?: string | null;
  consumptionMultiplier?: number;
}

export interface UpdateNodeInput {
  name?: string;
  address?: string;
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

export type XrayNetwork = 'raw' | 'xhttp' | 'ws' | 'grpc';

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
  | NaiveInboundConfig;

export interface Inbound {
  id: string;
  nodeId: string;
  protocol: ProtocolName;
  name: string;
  port: number;
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
  config: InboundConfig;
}

export interface UpdateInboundInput {
  name?: string;
  port?: number;
  enabled?: boolean;
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

/** Generate a fresh x25519 keypair for REALITY / AmneziaWG inbound. */
export async function generateInboundKeypair(): Promise<KeypairResponse> {
  const { data } = await api.post<KeypairResponse>('/api/inbounds/generate-keypair');
  return data;
}

export async function testSrrRule(userAgent: string): Promise<TestSrrResponse> {
  const { data } = await api.post<TestSrrResponse>('/api/srr/test', { userAgent });
  return data;
}
