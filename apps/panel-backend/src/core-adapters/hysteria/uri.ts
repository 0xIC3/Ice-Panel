/**
 * Hysteria 2 URI builder. The wire format is consumed directly by Hiddify,
 * NekoRay, v2rayN, the upstream `hysteria` client, and IcePath-VPN.
 *
 * Slice 16 — minimal builder (host:port + password + name fragment).
 * Slice 17 (inbounds CRUD) will extend with SNI / obfs / insecure / pinSHA256
 * once inbounds carry per-instance config.
 */

export interface HysteriaUriOpts {
  password: string;
  /** Host portion only — port is supplied separately so callers can split
   *  the control-plane port (panel↔node mTLS) from the client-facing UDP. */
  host: string;
  /** Public Hysteria2 UDP port the client connects to. */
  port: number;
  /** URL fragment shown in clients (typically the node name). */
  name: string;
}

export function buildHysteriaUri(opts: HysteriaUriOpts): string {
  // Drop the empty `?` query string — Hiddify's URI parser rejects
  // `hysteria2://...:443/?#name` ("Unknown parse outbound") even though it's
  // syntactically valid per RFC 3986. `hysteria2://...:443/#name` works in
  // Hiddify, NekoRay, the official `hysteria` client, and v2rayN. Once we
  // grow real query params (slice 24: obfs/sni/insecure/pinSHA256), build
  // the query conditionally and reintroduce the `?` only when non-empty.
  return `hysteria2://${encodeURIComponent(opts.password)}@${opts.host}:${opts.port}/#${encodeURIComponent(opts.name)}`;
}
