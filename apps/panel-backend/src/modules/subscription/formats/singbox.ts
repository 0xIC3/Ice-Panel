import type { SubscriptionEndpoint } from '../subscription.formats.js';

/**
 * Sing-box JSON subscription formatter (sing-box 1.10+).
 *
 * Targets Sing-box itself, Hiddify-Next, NekoBox-iOS, NekoBox-Android.
 *
 * Scope mirrors the Clash formatter: hysteria2 + vless+REALITY+Vision only.
 * AmneziaWG/Naive get their own native formats (wg-quick conf and the
 * naive+https URI respectively). Adding them here would require sing-box's
 * `wireguard` outbound (which lacks the AmneziaWG obfuscation params) or
 * a `naive` outbound that doesn't exist upstream.
 *
 * Output shape — minimal valid sing-box config:
 *   - `log`: standard
 *   - `outbounds`: per-endpoint proxies + Auto selector + direct
 *   - `route.final = "Auto"`: catch-all sends every connection through the
 *     selector. `auto_detect_interface: true` lets sing-box hop networks
 *     without restart.
 *
 * No `inbounds`, no `dns`, no `experimental` — the client app fills them in.
 * That keeps the body short and avoids drift across sing-box versions.
 */
export function buildSingboxJson(endpoints: SubscriptionEndpoint[]): string {
  const outbounds: Record<string, unknown>[] = [];
  const proxyTags: string[] = [];

  for (const e of endpoints) {
    const tag = `${e.nodeName}-${e.protocol}`;
    if (e.protocol === 'hysteria') {
      proxyTags.push(tag);
      // sing-box requires `tls.enabled: true` for hysteria2 outbounds —
      // without it the parser fails with "TLS required" (caught in Hiddify
      // 4.1.1 on 2026-05-06). Hysteria2 always uses TLS by design, so this
      // is purely a parser-satisfaction quirk.
      outbounds.push({
        type: 'hysteria2',
        tag,
        server: e.host,
        server_port: e.port,
        password: e.password,
        ...(e.obfsPassword
          ? { obfs: { type: 'salamander', password: e.obfsPassword } }
          : {}),
        tls: {
          enabled: true,
          server_name: e.host,
        },
      });
    } else if (e.protocol === 'xray') {
      proxyTags.push(tag);
      outbounds.push({
        type: 'vless',
        tag,
        server: e.host,
        server_port: e.port,
        uuid: e.uuid,
        flow: e.flow,
        tls: {
          enabled: true,
          server_name: e.sni,
          utls: { enabled: true, fingerprint: e.fingerprint },
          reality: {
            enabled: true,
            public_key: e.publicKey,
            short_id: e.shortId,
          },
        },
      });
    }
  }

  if (proxyTags.length > 0) {
    outbounds.push({
      type: 'selector',
      tag: 'Auto',
      outbounds: [...proxyTags, 'direct'],
      default: proxyTags[0],
    });
  }
  outbounds.push({ type: 'direct', tag: 'direct' });

  const config = {
    log: { level: 'info', timestamp: true },
    outbounds,
    route: {
      final: proxyTags.length > 0 ? 'Auto' : 'direct',
      auto_detect_interface: true,
    },
  };
  return JSON.stringify(config, null, 2) + '\n';
}
