import type { User, UserTraffic } from '../../generated/prisma/client.js';

export interface HysteriaUriOpts {
  password: string;
  address: string; // host[:port], no scheme — matches our nodes.address column
  name: string;
}

const DEFAULT_HYSTERIA_PORT = '443';

/**
 * Build a `hysteria2://` URI consumable by Hiddify, NekoRay, v2rayN, the
 * upstream `hysteria` client, and our own IcePath-VPN bot.
 *
 * Slice 12 keeps it minimal — no obfs/sni/insecure params yet. Slice 13
 * (E2E flow) will pull SNI + obfs from inbound config.
 */
export function buildHysteriaUri(opts: HysteriaUriOpts): string {
  const addr = opts.address.includes(':') ? opts.address : `${opts.address}:${DEFAULT_HYSTERIA_PORT}`;
  return `hysteria2://${encodeURIComponent(opts.password)}@${addr}/?#${encodeURIComponent(opts.name)}`;
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
