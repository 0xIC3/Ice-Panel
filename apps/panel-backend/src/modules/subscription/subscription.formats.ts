import type { User, UserTraffic } from '../../generated/prisma/client.js';

export interface HysteriaUriOpts {
  password: string;
  /** Host portion only — port comes separately so we can distinguish the
   *  control-plane port (panel→node mTLS) from the client-facing UDP port. */
  host: string;
  /** Public Hysteria2 UDP port the client connects to. */
  port: number;
  name: string;
}

/**
 * Build a `hysteria2://` URI consumable by Hiddify, NekoRay, v2rayN, the
 * upstream `hysteria` client, and our own IcePath-VPN bot.
 *
 * Slice 13 separates the host from the port; slice 17 (inbounds CRUD) will
 * carry SNI / obfs / insecure / pinSHA256 per inbound.
 */
export function buildHysteriaUri(opts: HysteriaUriOpts): string {
  return `hysteria2://${encodeURIComponent(opts.password)}@${opts.host}:${opts.port}/?#${encodeURIComponent(opts.name)}`;
}

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
  return Buffer.from(uris.join('\n'), 'utf8').toString('base64');
}

export interface SubscriptionEndpoint {
  protocol: 'hysteria';
  nodeName: string;
  uri: string;
}

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
