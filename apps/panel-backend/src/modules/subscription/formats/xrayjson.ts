import type { SubscriptionEndpoint } from '../subscription.formats.js';

/**
 * Xray-core client JSON subscription formatter.
 *
 * Targets v2rayN, NekoRay/NekoBox in Xray mode, and any client that imports
 * "Xray JSON" subscription URLs (i.e. apps that run xray-core under the hood).
 *
 * Scope: VLESS+REALITY+Vision endpoints only. Hysteria2 is reachable from
 * Xray (via the `hysteria2` outbound) but most Xray-native clients still
 * default to vmess/vless — users who want Hysteria pick the Sing-box format
 * or the plain hysteria2:// URI directly. Keeping this format VLESS-only
 * dodges the cross-protocol matrix and avoids subtle xray-version-coupled
 * outbound shape drift.
 *
 * Output shape:
 *   - `log`: warning-level
 *   - `inbounds`: a single SOCKS5 inbound on 127.0.0.1:10808 (UDP enabled)
 *     so local apps can dial through the tunnel
 *   - `outbounds`: one vless+REALITY entry per endpoint, plus `freedom`
 *     (`direct`) and `blackhole` (`block`) for routing rules
 *   - `routing`: catch-all → first proxy. The client UI lets the user pick
 *     a different outbound by tag.
 */
export function buildXrayJson(endpoints: SubscriptionEndpoint[]): string {
  const xrayEps = endpoints.filter((e) => e.protocol === 'xray');
  const proxyTags: string[] = [];

  const proxyOutbounds = xrayEps.map((e) => {
    if (e.protocol !== 'xray') throw new Error('unreachable'); // narrowing
    const tag = `${e.nodeName}-xray`;
    proxyTags.push(tag);
    return {
      tag,
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: e.host,
            port: e.port,
            users: [
              {
                id: e.uuid,
                encryption: 'none',
                flow: e.flow,
              },
            ],
          },
        ],
      },
      streamSettings: {
        network: 'raw',
        security: 'reality',
        realitySettings: {
          publicKey: e.publicKey,
          shortId: e.shortId,
          serverName: e.sni,
          fingerprint: e.fingerprint,
          show: false,
          spiderX: '',
        },
      },
    };
  });

  const config = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'socks-in',
        port: 10808,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
      },
    ],
    outbounds: [
      ...proxyOutbounds,
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'block', protocol: 'blackhole' },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        proxyTags.length > 0
          ? { type: 'field', network: 'tcp,udp', outboundTag: proxyTags[0] }
          : { type: 'field', network: 'tcp,udp', outboundTag: 'direct' },
      ],
    },
  };
  return JSON.stringify(config, null, 2) + '\n';
}
