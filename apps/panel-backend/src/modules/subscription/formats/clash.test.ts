import { describe, expect, it } from 'vitest';
import { buildClashYaml } from './clash.js';
import type { SubscriptionEndpoint } from '../subscription.formats.js';

const hysteriaEp: SubscriptionEndpoint = {
  protocol: 'hysteria',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 443,
  password: 'hy-secret',
  uri: 'hysteria2://...',
};

const xrayEp: SubscriptionEndpoint = {
  protocol: 'xray',
  nodeName: 'eu-1',
  host: 'n1.example.com',
  port: 443,
  uuid: '11111111-2222-3333-4444-555555555555',
  publicKey: 'pubkey-base64url',
  shortId: 'abc123',
  sni: 'www.cloudflare.com',
  flow: 'xtls-rprx-vision',
  fingerprint: 'chrome',
  uri: 'vless://...',
};

describe('buildClashYaml', () => {
  it('emits a hysteria2 proxy entry with mandatory fields', () => {
    const out = buildClashYaml([hysteriaEp]);
    expect(out).toContain('proxies:');
    expect(out).toContain('- name: eu-1-hysteria');
    expect(out).toContain('type: hysteria2');
    expect(out).toContain('server: n1.example.com');
    expect(out).toContain('port: 443');
    expect(out).toContain('password: hy-secret');
  });

  it('emits a vless reality proxy entry with reality-opts block', () => {
    const out = buildClashYaml([xrayEp]);
    expect(out).toContain('- name: eu-1-xray');
    expect(out).toContain('type: vless');
    expect(out).toContain('uuid: 11111111-2222-3333-4444-555555555555');
    expect(out).toContain('flow: xtls-rprx-vision');
    expect(out).toContain('client-fingerprint: chrome');
    expect(out).toContain('reality-opts:');
    expect(out).toContain('public-key: pubkey-base64url');
    expect(out).toContain('short-id: abc123');
    // SNI must be quoted because of the dots — but bare alnum + dots is allowed
    // by our yamlString, so no quotes needed.
    expect(out).toContain('servername: www.cloudflare.com');
  });

  it('builds a url-test proxy-group listing every emitted proxy', () => {
    const out = buildClashYaml([hysteriaEp, xrayEp]);
    expect(out).toContain('- name: Auto');
    expect(out).toContain('type: url-test');
    expect(out).toMatch(/proxies:\s*\n\s+- eu-1-hysteria\s*\n\s+- eu-1-xray/);
  });

  it('produces a MATCH,DIRECT rule when no endpoints are emitted', () => {
    const out = buildClashYaml([]);
    expect(out).toContain('- MATCH,DIRECT');
    expect(out).not.toContain('- MATCH,Auto');
    // Empty proxies/groups must be valid YAML — `[]` is the safe form.
    expect(out).toMatch(/proxies:\s*\n\s+\[\]/);
    expect(out).toMatch(/proxy-groups:\s*\n\s+\[\]/);
  });

  it('quotes special chars in passwords (e.g. colon, hash)', () => {
    const out = buildClashYaml([{ ...hysteriaEp, password: 'pa:ss#word' }]);
    expect(out).toContain('password: "pa:ss#word"');
  });

  it('quotes node names containing spaces or special chars', () => {
    const out = buildClashYaml([{ ...hysteriaEp, nodeName: 'eu node #1' }]);
    expect(out).toContain('"eu node #1-hysteria"');
  });

  it('output is byte-deterministic for the same input', () => {
    const a = buildClashYaml([hysteriaEp, xrayEp]);
    const b = buildClashYaml([hysteriaEp, xrayEp]);
    expect(a).toBe(b);
  });

  it('output ends with a newline', () => {
    expect(buildClashYaml([hysteriaEp]).endsWith('\n')).toBe(true);
  });
});
