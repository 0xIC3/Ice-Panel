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

export interface VlessRealityUriOpts {
  /** User's `xrayUuid` (matches the `id` field in the server's clients[] entry). */
  uuid: string;
  /** Public hostname the client connects to (no port). */
  host: string;
  /** Public TCP port the Xray inbound listens on. */
  port: number;
  /** REALITY public key — paired with the server's privateKey. */
  publicKey: string;
  /** One of the inbound's REALITY shortIds (typically a small hex string). */
  shortId: string;
  /** Target serverName the client claims via SNI. */
  sni: string;
  /** Vision flow control. Default: `xtls-rprx-vision`. */
  flow?: string;
  /** TLS fingerprint. Default: `chrome`. */
  fingerprint?: string;
  /** URL fragment shown by the client (typically the node name). */
  name: string;
}

export function buildVlessRealityUri(opts: VlessRealityUriOpts): string {
  const params = new URLSearchParams({
    type: 'raw',
    security: 'reality',
    encryption: 'none',
    pbk: opts.publicKey,
    sid: opts.shortId,
    sni: opts.sni,
    fp: opts.fingerprint ?? 'chrome',
    flow: opts.flow ?? 'xtls-rprx-vision',
  });
  return `vless://${opts.uuid}@${opts.host}:${opts.port}?${params.toString()}#${encodeURIComponent(opts.name)}`;
}
