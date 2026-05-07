import { describe, expect, it } from 'vitest';
import { buildMtprotoUri, buildMtprotoTmeUri, mtprotoSecret } from './uri.js';

describe('mtprotoSecret (single-secret-per-inbound model)', () => {
  it('produces ee + 64 hex bytes (sha256) + domain hex', () => {
    const s = mtprotoSecret('inbound-uuid-1', 'www.cloudflare.com');
    expect(s.startsWith('ee')).toBe(true);
    expect(s).toHaveLength(2 + 64 + 'www.cloudflare.com'.length * 2);
    const domainHex = Buffer.from('www.cloudflare.com', 'utf8').toString('hex');
    expect(s.endsWith(domainHex)).toBe(true);
  });

  it('is deterministic for same (inboundId, domain)', () => {
    const a = mtprotoSecret('inbound-1', 'www.example.com');
    const b = mtprotoSecret('inbound-1', 'www.example.com');
    expect(a).toBe(b);
  });

  it('different inbound IDs yield different secrets', () => {
    const a = mtprotoSecret('inbound-1', 'www.cloudflare.com');
    const b = mtprotoSecret('inbound-2', 'www.cloudflare.com');
    expect(a).not.toBe(b);
  });

  it('domain change rotates the entire secret', () => {
    const a = mtprotoSecret('inbound-1', 'www.cloudflare.com');
    const b = mtprotoSecret('inbound-1', 'www.google.com');
    expect(a).not.toBe(b);
    // Both head and tail differ — head because the seed includes the
    // domain, tail because the domain is appended.
    expect(a.slice(0, 66)).not.toBe(b.slice(0, 66));
  });
});

describe('buildMtprotoUri', () => {
  const opts = {
    secret: 'eeAA',
    host: 'proxy.example.com',
    port: 443,
    name: 'se-mtg-01',
  };

  it('emits tg://proxy?... form with all required params', () => {
    const uri = buildMtprotoUri(opts);
    expect(uri.startsWith('tg://proxy?')).toBe(true);
    expect(uri).toContain('server=proxy.example.com');
    expect(uri).toContain('port=443');
    expect(uri).toContain('secret=eeAA');
  });

  it('appends URI-encoded fragment', () => {
    expect(buildMtprotoUri(opts).endsWith('#se-mtg-01')).toBe(true);
    expect(buildMtprotoUri({ ...opts, name: 'se mtg #1' })).toContain(
      '#se%20mtg%20%231',
    );
  });
});

describe('buildMtprotoTmeUri', () => {
  it('emits https://t.me/proxy?... with no fragment', () => {
    const uri = buildMtprotoTmeUri({
      secret: 'eeBB',
      host: 'proxy.example.com',
      port: 443,
    });
    expect(uri.startsWith('https://t.me/proxy?')).toBe(true);
    expect(uri).toContain('server=proxy.example.com');
    expect(uri).toContain('secret=eeBB');
    // t.me strips fragments — never emit one
    expect(uri).not.toContain('#');
  });
});
