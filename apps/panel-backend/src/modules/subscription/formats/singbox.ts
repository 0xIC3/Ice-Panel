import type { SubscriptionEndpoint } from '../subscription.formats.js';

/**
 * Sing-box JSON subscription formatter (sing-box 1.10+).
 *
 * Targets Sing-box itself, Hiddify-Next, NekoBox-iOS, NekoBox-Android.
 *
 * Scope:
 *   - hysteria2          (slice 21)
 *   - xray vless+REALITY (slice 21, slice 24c part 2 transports)
 *   - xray trojan+REALITY (slice 24c part 3a)
 *   - shadowsocks (SS2022 + legacy AEAD) (slice 24d)
 *
 * AmneziaWG/Naive are NOT emitted: AmneziaWG users get the wg-quick `.conf`
 * format; Naive users get the `naive+https` URI directly. Adding them here
 * would require sing-box's `wireguard` outbound (which lacks the AmneziaWG
 * obfuscation params) or a `naive` outbound that doesn't exist upstream.
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
        // Brutal CC bandwidth declaration. Without these the client
        // negotiates a 0-byte send window — handshake succeeds but every
        // proxied request times out at tx=0. The server can override via
        // `ignoreClientBandwidth: true` (recommended default in our
        // adapter), but supplying real values here keeps Brutal CC active
        // when the server does honour client bandwidth.
        up_mbps: e.upMbps ?? 50,
        down_mbps: e.downMbps ?? 100,
        ...(e.obfsPassword
          ? { obfs: { type: 'salamander', password: e.obfsPassword } }
          : {}),
        tls: {
          enabled: true,
          server_name: e.host,
          // ALPN h3 is mandatory for some sing-box / Hiddify iOS builds —
          // without it the QUIC stream multiplexer never opens proxy
          // streams even though the QUIC connection itself is fine.
          alpn: ['h3'],
        },
      });
    } else if (e.protocol === 'xray') {
      proxyTags.push(tag);

      // Slice 24c part 3a — branch outbound type on subprotocol. Trojan
      // shares REALITY but uses a password and no Vision flow.
      const isTrojan = e.subprotocol === 'trojan';

      // Slice 24c part 2 — transport selector. Reality+Vision canonical is
      // `raw`; clients accept omitted transport for raw, but other transports
      // need an explicit `transport` block per sing-box schema.
      const transport =
        e.network === 'ws'
          ? {
              transport: {
                type: 'ws',
                ...(e.path ? { path: e.path } : {}),
                ...(e.hostHeader ? { headers: { Host: e.hostHeader } } : {}),
              },
            }
          : e.network === 'httpupgrade'
            ? {
                transport: {
                  type: 'httpupgrade',
                  ...(e.path ? { path: e.path } : {}),
                  ...(e.hostHeader ? { host: e.hostHeader } : {}),
                },
              }
            : e.network === 'grpc'
              ? {
                  transport: {
                    type: 'grpc',
                    service_name: e.serviceName ?? '',
                  },
                }
              : {};

      outbounds.push({
        type: isTrojan ? 'trojan' : 'vless',
        tag,
        server: e.host,
        server_port: e.port,
        ...(isTrojan
          ? { password: e.uuid }                      // Trojan: UUID is the password
          : { uuid: e.uuid, ...(e.flow ? { flow: e.flow } : {}) }), // VLESS
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
        ...transport,
      });
    } else if (e.protocol === 'shadowsocks') {
      // Slice 24d — Shadowsocks 2022 (and legacy AEAD). No TLS layer; the
      // AEAD ciphertext is the disguise. method+password drives the outbound.
      proxyTags.push(tag);
      outbounds.push({
        type: 'shadowsocks',
        tag,
        server: e.host,
        server_port: e.port,
        method: e.method,
        password: e.password,
        // SS2022 supports UDP relay; sing-box defaults `network: tcp` so
        // we must enable UDP explicitly to match what the server emits.
        network: 'tcp',
        udp_over_tcp: false,
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
