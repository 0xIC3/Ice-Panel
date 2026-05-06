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
  // Hiddify's outbound parser was failing on bare `hysteria2://...:443/#name`
  // ("Unknown parse outbound") on 2026-05-06. Adding an explicit `sni` query
  // param fixes it — even when SNI matches host (which Hysteria infers
  // automatically), some clients want it spelled out. Slice 24 will replace
  // this with the full obfs/insecure/pinSHA256 query builder.
  const params = new URLSearchParams();
  params.set('sni', opts.host);
  return `hysteria2://${encodeURIComponent(opts.password)}@${opts.host}:${opts.port}/?${params.toString()}#${encodeURIComponent(opts.name)}`;
}
