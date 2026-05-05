import type { SubscriptionEndpoint } from '../subscription.formats.js';

/**
 * Clash YAML subscription formatter (targets Clash Meta — covers VLESS+REALITY
 * and Hysteria2 native types).
 *
 * Scope:
 *   - hysteria → `type: hysteria2`
 *   - xray (VLESS+REALITY+Vision) → `type: vless` with `reality-opts`
 *   - amneziawg/naive are NOT emitted: classic Clash has no native support
 *     and Clash Meta's experimental wireguard/naive support diverges per
 *     fork. AmneziaWG users get the wg-quick `.conf` format; Naive users
 *     get the naive+https URI directly.
 *
 * The output is hand-emitted YAML (no js-yaml dep): the schema is fixed and
 * small, and string-based generation gives us bit-for-bit deterministic
 * output across runs (good for diff-testing and avoiding spurious config
 * reloads in clients that hash the body).
 */

// Quote a value with double quotes if it contains anything that would need
// escaping in YAML, otherwise emit it bare. Conservative: passwords, names,
// and reality short-ids may contain `:`, `#`, special chars.
function yamlString(value: string): string {
  if (/^[A-Za-z0-9_\-./]+$/.test(value)) return value;
  return JSON.stringify(value); // double-quoted, JSON escapes are valid YAML
}

export function buildClashYaml(endpoints: SubscriptionEndpoint[]): string {
  const proxies: string[] = [];
  const proxyNames: string[] = [];

  for (const e of endpoints) {
    const name = `${e.nodeName}-${e.protocol}`;
    if (e.protocol === 'hysteria') {
      proxyNames.push(name);
      proxies.push(
        [
          `  - name: ${yamlString(name)}`,
          `    type: hysteria2`,
          `    server: ${e.host}`,
          `    port: ${e.port}`,
          `    password: ${yamlString(e.password)}`,
        ].join('\n'),
      );
    } else if (e.protocol === 'xray') {
      proxyNames.push(name);
      proxies.push(
        [
          `  - name: ${yamlString(name)}`,
          `    type: vless`,
          `    server: ${e.host}`,
          `    port: ${e.port}`,
          `    uuid: ${e.uuid}`,
          `    network: tcp`,
          `    tls: true`,
          `    udp: true`,
          `    servername: ${yamlString(e.sni)}`,
          `    flow: ${yamlString(e.flow)}`,
          `    client-fingerprint: ${yamlString(e.fingerprint)}`,
          `    reality-opts:`,
          `      public-key: ${yamlString(e.publicKey)}`,
          `      short-id: ${yamlString(e.shortId)}`,
        ].join('\n'),
      );
    }
  }

  const lines: string[] = [];
  lines.push('proxies:');
  if (proxies.length === 0) {
    lines.push('  []');
  } else {
    lines.push(...proxies);
  }
  lines.push('');

  lines.push('proxy-groups:');
  if (proxyNames.length > 0) {
    lines.push('  - name: Auto');
    lines.push('    type: url-test');
    lines.push('    url: http://www.gstatic.com/generate_204');
    lines.push('    interval: 300');
    lines.push('    proxies:');
    for (const n of proxyNames) {
      lines.push(`      - ${yamlString(n)}`);
    }
  } else {
    lines.push('  []');
  }
  lines.push('');

  lines.push('rules:');
  lines.push(proxyNames.length > 0 ? '  - MATCH,Auto' : '  - MATCH,DIRECT');

  return lines.join('\n') + '\n';
}
