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
 * Derive a deterministic Fake-TLS MTProto secret from the user's UUID and
 * the inbound's masquerade domain.
 *
 * Returns a hex string of the form:
 *   ee<32-hex-bytes-from-sha256(uuid)><hex-encoded-domain-ASCII>
 *
 * Determinism property: same (uuid, domain) → same secret. That's the
 * coupling that makes "domain change rotates every user's secret" — we
 * exploit it on the agent side too (mtg config rebuild emits the same
 * secret as the panel-side URI builder).
 *
 * Why sha256 and not the raw UUID bytes: UUID v4 is 16 bytes (128 bits)
 * but the secret slot is 32 bytes (256 bits). sha256 stretches; equally
 * any KDF would work, sha256 is just universal.
 */
export function mtprotoSecret(uuid: string, domain: string): string {
  const userBytes = createHash('sha256').update(uuid, 'utf8').digest();
  const userHex = userBytes.toString('hex');         // 64 hex chars (32 bytes)
  const domainHex = Buffer.from(domain, 'utf8').toString('hex');
  return `ee${userHex}${domainHex}`;
}
