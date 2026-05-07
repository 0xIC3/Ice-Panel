/**
 * Shadowsocks URI builder. Slice 24d.
 *
 * SIP002 wire format (consumed by Shadowsocks-android, Shadowrocket,
 * Outline, NekoBox, Hiddify, etc):
 *
 *   ss://<base64url(method:password)>@<host>:<port>#<fragment>
 *
 * The `method:password` tuple is base64url-encoded WITHOUT padding to keep
 * it URL-safe (the original SIP002 spec used base64-standard, but every
 * modern client tolerates base64url and several reject `+/=` in the
 * userinfo segment).
 *
 * SS2022 ciphers (`2022-blake3-*`) and legacy AEAD (`chacha20-ietf-poly1305`,
 * `aes-256-gcm`, etc) share the same URI shape — clients pick the right
 * crypto path from the method string itself.
 */

export type ShadowsocksMethod =
  | '2022-blake3-aes-128-gcm'
  | '2022-blake3-aes-256-gcm'
  | '2022-blake3-chacha20-poly1305'
  | 'chacha20-ietf-poly1305'
  | 'aes-256-gcm'
  | 'aes-128-gcm';

export interface ShadowsocksUriOpts {
  method: ShadowsocksMethod;
  password: string;
  host: string;
  port: number;
  /** URL fragment shown in clients (typically the node name). */
  name: string;
}

export function buildShadowsocksUri(opts: ShadowsocksUriOpts): string {
  const userinfo = base64UrlNoPad(`${opts.method}:${opts.password}`);
  return `ss://${userinfo}@${opts.host}:${opts.port}#${encodeURIComponent(opts.name)}`;
}

/** base64url without padding — the URI-safe encoding clients expect. */
function base64UrlNoPad(input: string): string {
  // Node 22 has Buffer; tests run under Vitest+Node, panel runs under Node.
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
