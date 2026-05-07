/**
 * MTProto Telegram-proxy URI builder. Slice 41.
 *
 * Telegram clients accept two equivalent forms (both open the same
 * "Use this proxy?" dialog):
 *
 *   tg://proxy?server=<host>&port=<port>&secret=<hex>
 *   https://t.me/proxy?server=<host>&port=<port>&secret=<hex>
 *
 * The `https://t.me/proxy?...` form is preferred for distribution because
 * it works as a clickable link in any browser/messenger without the OS
 * needing to register the `tg://` scheme. The native `tg://` form opens
 * directly in the TG app on most mobile platforms.
 *
 * Secret format (Fake-TLS, the only mode current TG clients accept):
 *
 *   ee<32-hex-bytes-secret><hex-encoded-domain>
 *
 *   - Leading byte `0xee` (`ee`) selects Fake-TLS mode.
 *   - 32-byte secret is per-user (we derive from sha256(xrayUuid) :32 ).
 *   - Trailing bytes are the masquerade domain ASCII bytes hex-encoded.
 *
 * Reference: docs/references/mtproto.md
 */

import { createHash } from 'node:crypto';

export interface MtprotoUriOpts {
  /** Hex-encoded `ee<32-bytes><domain-hex>` (use `mtprotoSecret()` to derive). */
  secret: string;
  host: string;
  port: number;
  /** URL fragment shown in clients (typically the node name). */
  name: string;
}

/** Native deep-link form. Opens directly in the Telegram app. */
export function buildMtprotoUri(opts: MtprotoUriOpts): string {
  const params = new URLSearchParams({
    server: opts.host,
    port: String(opts.port),
    secret: opts.secret,
  });
  return `tg://proxy?${params.toString()}#${encodeURIComponent(opts.name)}`;
}

/**
 * Web-bouncer form: `https://t.me/proxy?...`. Works as a regular HTTP link
 * (clickable in any browser/messenger) and Telegram's t.me service
 * redirects to the in-app proxy dialog.
 *
 * No `#fragment` — t.me strips it.
 */
export function buildMtprotoTmeUri(
  opts: Omit<MtprotoUriOpts, 'name'>,
): string {
  const params = new URLSearchParams({
    server: opts.host,
    port: String(opts.port),
    secret: opts.secret,
  });
  return `https://t.me/proxy?${params.toString()}`;
}

/**
 * Derive a deterministic Fake-TLS MTProto secret for an inbound.
 *
 * Returns a hex string of the form:
 *   ee<32-hex-bytes-from-sha256(inboundId:domain)><hex-encoded-domain-ASCII>
 *
 * **Single-secret architecture (slice 41):** 9seconds/mtg upstream rejects
 * multi-secret support — one mtg instance == one secret. We follow that
 * constraint: secret is derived once per inbound, not per user. Every user
 * assigned to this inbound's squad receives the SAME URL.
 *
 * Inputs to the hash:
 *   - `inboundId` (UUID, stable across the inbound's lifetime)
 *   - `domain` (admin-changeable; change rotates the secret)
 *
 * Both panel and agent compute the identical value when given the same
 * (inboundId, domain) pair, so the panel can push a secret over the wire
 * and the agent can independently re-derive for verification.
 */
export function mtprotoSecret(inboundId: string, domain: string): string {
  const seed = `${inboundId}:${domain}`;
  const seedBytes = createHash('sha256').update(seed, 'utf8').digest();
  const seedHex = seedBytes.toString('hex'); // 64 hex chars (32 bytes)
  const domainHex = Buffer.from(domain, 'utf8').toString('hex');
  return `ee${seedHex}${domainHex}`;
}
