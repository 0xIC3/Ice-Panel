import type { User, UserTraffic } from '../../generated/prisma/client.js';
import type { ProtocolName } from '@ice-panel/shared';

// Re-export so existing imports keep working (slice 16 moved the
// implementation into core-adapters/hysteria — this file now hosts only
// the format-level helpers that are not protocol-specific).
export { buildHysteriaUri, type HysteriaUriOpts } from '../../core-adapters/hysteria/index.js';
export { buildVlessRealityUri, type VlessRealityUriOpts } from '../../core-adapters/xray/index.js';

/**
 * Strip the optional `:port` suffix from a `host[:port]` string. Returns
 * just the host (or the original input if it has no `:`).
 */
export function hostFromAddress(address: string): string {
  const idx = address.indexOf(':');
  return idx === -1 ? address : address.slice(0, idx);
}

/**
 * Universal subscription body: base64 of newline-separated URIs. Works with
 * every mainstream client (NekoRay, Hiddify, v2rayN, ...).
 */
export function encodePlainList(uris: string[]): string {
  // Filter empty URIs — amneziawg endpoints don't have a URL form, so they
  // contribute nothing to the universal plain-list body. Clients that want
  // AmneziaWG fetch with `?format=wgconf`.
  const nonEmpty = uris.filter((u) => u.length > 0);
  return Buffer.from(nonEmpty.join('\n'), 'utf8').toString('base64');
}

interface SubscriptionEndpointBase {
  protocol: ProtocolName;
  nodeName: string;
  /** Public host the client connects to (no port). */
  host: string;
  /** Public port the client connects to. */
  port: number;
  /** Pre-built URI for plain-list/JSON formats. Format-specific builders
   *  (Clash, Sing-box, ...) consume the structured fields below instead. */
  uri: string;
}

export interface HysteriaSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'hysteria';
  password: string;
}

export interface XraySubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'xray';
  uuid: string;
  publicKey: string;
  shortId: string;
  sni: string;
  flow: string;
  fingerprint: string;
}

export interface AmneziawgSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'amneziawg';
  /** User's WireGuard private key. */
  privateKey: string;
  /** IP allocated to this user inside the inbound's subnet, CIDR /32 form. */
  allowedIp: string;
  /** Server's WireGuard public key (the inbound's interface PublicKey). */
  serverPublicKey: string;
  /** Junk/header obfuscation parameters — must match the server inbound. */
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

export interface NaiveSubscriptionEndpoint extends SubscriptionEndpointBase {
  protocol: 'naive';
  username: string;
  password: string;
}

export type SubscriptionEndpoint =
  | HysteriaSubscriptionEndpoint
  | XraySubscriptionEndpoint
  | AmneziawgSubscriptionEndpoint
  | NaiveSubscriptionEndpoint;

export interface SubscriptionJsonResponse {
  user: {
    id: string;
    shortId: string;
    username: string;
    status: string;
    expireAt: string | null;
    trafficLimitBytes: number | null;
    trafficUsedBytes: number;
  };
  endpoints: SubscriptionEndpoint[];
}

/**
 * Structured JSON for IcePath-VPN Mini-App (Go) and Ice-Client (Rust).
 * Includes user-state metadata so clients can show quota/expiry without a
 * second request.
 */
export function buildSubscriptionJson(
  user: User & { traffic: UserTraffic | null },
  endpoints: SubscriptionEndpoint[],
): SubscriptionJsonResponse {
  return {
    user: {
      id: user.id,
      shortId: user.shortId,
      username: user.username,
      status: user.status,
      expireAt: user.expireAt ? user.expireAt.toISOString() : null,
      trafficLimitBytes:
        user.trafficLimitBytes !== null ? Number(user.trafficLimitBytes) : null,
      trafficUsedBytes: user.traffic ? Number(user.traffic.usedTrafficBytes) : 0,
    },
    endpoints,
  };
}
