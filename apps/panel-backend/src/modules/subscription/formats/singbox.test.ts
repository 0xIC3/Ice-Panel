import { describe, expect, it } from 'vitest';
import { buildSingboxJson } from './singbox.js';
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

function parse(out: string): { outbounds: any[]; route: any; log: any } {
  return JSON.parse(out);
}

describe('buildSingboxJson', () => {
  it('outputs valid JSON ending in a newline', () => {
    const out = buildSingboxJson([hysteriaEp]);
    expect(out.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('emits a hysteria2 outbound with mandatory fields', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp]));
    const hy = cfg.outbounds.find((o: any) => o.type === 'hysteria2');
    expect(hy).toBeDefined();
    expect(hy.tag).toBe('eu-1-hysteria');
    expect(hy.server).toBe('n1.example.com');
    expect(hy.server_port).toBe(443);
    expect(hy.password).toBe('hy-secret');
  });

  it('emits a vless+REALITY outbound nested under tls', () => {
    const cfg = parse(buildSingboxJson([xrayEp]));
    const v = cfg.outbounds.find((o: any) => o.type === 'vless');
    expect(v).toBeDefined();
    expect(v.uuid).toBe('11111111-2222-3333-4444-555555555555');
    expect(v.flow).toBe('xtls-rprx-vision');
    expect(v.tls.enabled).toBe(true);
    expect(v.tls.server_name).toBe('www.cloudflare.com');
    expect(v.tls.utls.fingerprint).toBe('chrome');
    expect(v.tls.reality.enabled).toBe(true);
    expect(v.tls.reality.public_key).toBe('pubkey-base64url');
    expect(v.tls.reality.short_id).toBe('abc123');
  });

  it('appends an Auto selector listing every proxy plus direct', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp, xrayEp]));
    const sel = cfg.outbounds.find((o: any) => o.type === 'selector');
    expect(sel.tag).toBe('Auto');
    expect(sel.outbounds).toEqual(['eu-1-hysteria', 'eu-1-xray', 'direct']);
    expect(sel.default).toBe('eu-1-hysteria');
  });

  it('always includes a direct outbound', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp]));
    expect(cfg.outbounds.find((o: any) => o.type === 'direct' && o.tag === 'direct')).toBeDefined();
  });

  it('routes everything through Auto via route.final', () => {
    const cfg = parse(buildSingboxJson([hysteriaEp]));
    expect(cfg.route.final).toBe('Auto');
    expect(cfg.route.auto_detect_interface).toBe(true);
  });

  it('falls back to route.final = direct when no proxies are emitted', () => {
    const cfg = parse(buildSingboxJson([]));
    expect(cfg.route.final).toBe('direct');
    // No selector when empty.
    expect(cfg.outbounds.find((o: any) => o.type === 'selector')).toBeUndefined();
    // Just the direct outbound.
    expect(cfg.outbounds).toHaveLength(1);
  });

  it('output is byte-deterministic for the same input', () => {
    const a = buildSingboxJson([hysteriaEp, xrayEp]);
    const b = buildSingboxJson([hysteriaEp, xrayEp]);
    expect(a).toBe(b);
  });
});
