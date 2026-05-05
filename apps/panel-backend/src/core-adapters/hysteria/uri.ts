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
  return `hysteria2://${encodeURIComponent(opts.password)}@${opts.host}:${opts.port}/?#${encodeURIComponent(opts.name)}`;
}
