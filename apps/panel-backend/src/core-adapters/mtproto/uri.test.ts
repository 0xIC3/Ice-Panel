import { describe, expect, it } from 'vitest';
import { buildMtprotoUri, buildMtprotoTmeUri, mtprotoSecret } from './uri.js';

describe('mtprotoSecret', () => {
  it('produces ee + 64 hex bytes (sha256) + domain hex', () => {
    const s = mtprotoSecret('cabc78ae-94e3-4a16-936a-133d059acfac', 'www.cloudflare.com');
    expect(s.startsWith('ee')).toBe(true);
    // ee (2) + sha256 (64) + 'www.cloudflare.com'.length * 2 = 36 → total 102
    expect(s).toHaveLength(2 + 64 + 'www.cloudflare.com'.length * 2);
    // last bytes are domain hex-encoded
    const domainHex = Buffer.from('www.cloudflare.com', 'utf8').toString('hex');
    expect(s.endsWith(domainHex)).toBe(true);
  });

  it('is deterministic', () => {
    const a = mtprotoSecret('uuid', 'www.example.com');
    const b = mtprotoSecret('uuid', 'www.example.com');
    expect(a).toBe(b);
  });

  it('domain change rotates the secret tail', () => {
    const a = mtprotoSecret('uuid', 'www.cloudflare.com');
    const b = mtprotoSecret('uuid', 'www.google.com');
    expect(a).not.toBe(b);
    // sha256(uuid) prefix should still be identical (first 2+64 chars)
    expect(a.slice(0, 66)).toBe(b.slice(0, 66));
    // tail differs
    expect(a.slice(66)).not.toBe(b.slice(66));
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
