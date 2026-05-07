/**
 * VLESS + REALITY + Vision URI builder for Xray-core clients (v2rayN,
 * NekoRay, Hiddify in Xray mode, etc).
 *
 * Wire format:
 *   vless://<uuid>@<host>:<port>?<query>#<fragment>
 *
 * Query params we set (per Xray docs as of v24.9.30):
 *   type=raw          — network mode (renamed from `tcp` in v24.9.30)
 *   security=reality  — REALITY TLS replacement
 *   encryption=none   — VLESS does no payload crypto (TLS does it)
 *   pbk=<pubkey>      — REALITY public key (paired with server's privateKey)
 *   sid=<shortId>     — one of the inbound's REALITY shortIds
 *   sni=<host>        — REALITY target serverName the client claims
 *   fp=<fingerprint>  — TLS fingerprint (chrome/firefox/safari/...)
 *   flow=<flow>       — `xtls-rprx-vision` for Vision (REALITY-recommended)
 *
 * Slice 17 — flat builder; slice 23 (inbound editor) will pull these from
 * the inbounds table per-instance.
 */

export type VlessNetwork = 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';

export interface VlessRealityUriOpts {
  uuid: string;
  host: string;
  port: number;
  publicKey: string;
  shortId: string;
  sni: string;
  flow?: string;
  fingerprint?: string;
  name: string;
  /** Stream transport. Default `raw` (canonical REALITY+Vision). */
  network?: VlessNetwork;
  /** Path for ws / xhttp. Ignored for raw / grpc. */
  path?: string;
  /** Host-header override for ws / xhttp. */
  hostHeader?: string;
  /** gRPC serviceName. Required when network=grpc. */
  serviceName?: string;
}

export function buildVlessRealityUri(opts: VlessRealityUriOpts): string {
  const network: VlessNetwork = opts.network ?? 'raw';
  const flow = opts.flow ?? 'xtls-rprx-vision';

  const params = new URLSearchParams({
    type: network,
    security: 'reality',
    encryption: 'none',
    pbk: opts.publicKey,
    sid: opts.shortId,
    sni: opts.sni,
    fp: opts.fingerprint ?? 'chrome',
  });

  // Vision is only meaningful with raw/xhttp. ws/grpc/httpupgrade/kcp don't
  // accept it — most clients ignore it, but a few (Xray itself when strict)
  // reject the URI.
  if (flow && (network === 'raw' || network === 'xhttp')) {
    params.set('flow', flow);
  }

  // path + host header — same param names across ws/xhttp/httpupgrade per
  // VLESS URI convention. kcp doesn't carry path/host.
  if (network === 'ws' || network === 'xhttp' || network === 'httpupgrade') {
    if (opts.path) params.set('path', opts.path);
    if (opts.hostHeader) params.set('host', opts.hostHeader);
  }
  if (network === 'grpc' && opts.serviceName) {
    params.set('serviceName', opts.serviceName);
  }
  if (network === 'kcp') {
    // header type — `none` is the safest default; admins picking obfuscated
    // mTLS-like profiles (`wechat-video`, etc) can override the inbound
    // streamSettings on the node side, but URI surface stays minimal.
    params.set('headerType', 'none');
  }

  return `vless://${opts.uuid}@${opts.host}:${opts.port}?${params.toString()}#${encodeURIComponent(opts.name)}`;
}
