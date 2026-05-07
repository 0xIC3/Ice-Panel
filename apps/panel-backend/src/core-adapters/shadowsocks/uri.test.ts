import { describe, expect, it } from 'vitest';
import { buildShadowsocksUri } from './uri.js';

const baseOpts = {
  method: '2022-blake3-aes-256-gcm' as const,
  password: 'cabc78ae-94e3-4a16-936a-133d059acfac',
  host: 'ss.example.com',
  port: 8388,
  name: 'se-ss-01',
};

describe('buildShadowsocksUri', () => {
  it('uses ss:// scheme with base64url-encoded userinfo', () => {
    const uri = buildShadowsocksUri(baseOpts);
    expect(uri.startsWith('ss://')).toBe(true);
    expect(uri).toContain('@ss.example.com:8388');

    // Decode the userinfo: should be `<method>:<password>`
    const userinfo = uri.slice('ss://'.length, uri.indexOf('@'));
    // base64url → base64 (re-add padding for Buffer.from)
    const base64 = userinfo.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    expect(decoded).toBe(`${baseOpts.method}:${baseOpts.password}`);
  });

  it('emits no padding (=) in userinfo', () => {
    const uri = buildShadowsocksUri(baseOpts);
    const userinfo = uri.slice('ss://'.length, uri.indexOf('@'));
    expect(userinfo).not.toContain('=');
  });

  it('uses base64url alphabet (no + or /)', () => {
    // Force a payload that would produce + or / in standard base64.
    const uri = buildShadowsocksUri({
      ...baseOpts,
      password: '\xff\xff\xff', // raw bytes that base64 to /// or +++
    });
    const userinfo = uri.slice('ss://'.length, uri.indexOf('@'));
    expect(userinfo).not.toMatch(/[+/]/);
  });

  it('appends fragment from name', () => {
    expect(buildShadowsocksUri(baseOpts).endsWith('#se-ss-01')).toBe(true);
  });

  it('encodes name fragment for URI safety', () => {
    const uri = buildShadowsocksUri({ ...baseOpts, name: 'node 1 / RU' });
    expect(uri).toContain('#node%201%20%2F%20RU');
  });

  it('supports legacy AEAD ciphers', () => {
    const uri = buildShadowsocksUri({
      ...baseOpts,
      method: 'chacha20-ietf-poly1305',
    });
    const userinfo = uri.slice('ss://'.length, uri.indexOf('@'));
    const base64 = userinfo.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    expect(decoded.startsWith('chacha20-ietf-poly1305:')).toBe(true);
  });
});
