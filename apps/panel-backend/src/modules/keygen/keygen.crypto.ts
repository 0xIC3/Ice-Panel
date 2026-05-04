import * as x509 from '@peculiar/x509';
import { webcrypto } from 'node:crypto';

// @peculiar/x509 needs an explicit Crypto provider. Node 20+ ships native
// webcrypto under node:crypto — we wire it once at module load.
x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const TEN_YEARS_MS = 10 * ONE_YEAR_MS;

// OIDs for ExtendedKeyUsage extension
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const OID_CLIENT_AUTH = '1.3.6.1.5.5.7.3.2';

export interface CertBundle {
  certPem: string;
  privateKeyPem: string;
}

export interface NodeCertOptions {
  commonName: string;
  /** Subject Alternative Names (DNS / IP) for the node's address. */
  sans?: { type: 'dns' | 'ip'; value: string }[];
}

// Node's webcrypto types and the DOM CryptoKey @peculiar/x509 expects are
// structurally the same at runtime but treated as distinct by TypeScript
// (Node 22 webcrypto adds 'decapsulateBits' to KeyUsage which DOM doesn't have).
// We use `any` at this boundary instead of fighting the type system.
type Key = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ───── PEM <-> DER helpers (private keys) ─────

function privateKeyDerToPem(der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64');
  const wrapped = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

function pemToDer(pem: string): ArrayBuffer {
  const cleaned = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Buffer.from(cleaned, 'base64').buffer;
}

async function importPrivateKey(pem: string): Promise<Key> {
  return webcrypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    ALGORITHM,
    false,
    ['sign'],
  );
}

async function exportPrivateKeyPem(key: Key): Promise<string> {
  const der = await webcrypto.subtle.exportKey('pkcs8', key);
  return privateKeyDerToPem(der);
}

// ───── Serial numbers ─────

function randomSerialHex(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  // Top bit must be 0 — ASN.1 INTEGER is signed.
  bytes[0]! &= 0x7f;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ───── CA generation ─────

export async function generateCa(): Promise<CertBundle> {
  const keys = (await webcrypto.subtle.generateKey(
    ALGORITHM,
    true,
    ['sign', 'verify'],
  )) as { publicKey: Key; privateKey: Key };

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerialHex(),
    subject: 'CN=Ice-Panel CA',
    issuer: 'CN=Ice-Panel CA',
    notBefore: new Date(),
    notAfter: new Date(Date.now() + TEN_YEARS_MS),
    signingAlgorithm: ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: keys.privateKey,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });

  return {
    certPem: cert.toString('pem'),
    privateKeyPem: await exportPrivateKeyPem(keys.privateKey),
  };
}

// ───── Per-node cert (signed by CA) ─────

export async function generateNodeCert(
  ca: CertBundle,
  opts: NodeCertOptions,
): Promise<CertBundle> {
  const caCert = new x509.X509Certificate(ca.certPem);
  const caKey = await importPrivateKey(ca.privateKeyPem);

  const keys = (await webcrypto.subtle.generateKey(
    ALGORITHM,
    true,
    ['sign', 'verify'],
  )) as { publicKey: Key; privateKey: Key };

  const extensions: x509.Extension[] = [
    new x509.BasicConstraintsExtension(false, undefined, true),
    new x509.KeyUsagesExtension(
      x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
      true,
    ),
    new x509.ExtendedKeyUsageExtension([OID_SERVER_AUTH, OID_CLIENT_AUTH], true),
  ];

  if (opts.sans && opts.sans.length > 0) {
    extensions.push(
      new x509.SubjectAlternativeNameExtension(
        opts.sans.map((s) => ({ type: s.type, value: s.value })),
      ),
    );
  }

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: randomSerialHex(),
    subject: `CN=${opts.commonName}`,
    issuer: caCert.subject,
    notBefore: new Date(),
    notAfter: new Date(Date.now() + ONE_YEAR_MS),
    signingAlgorithm: ALGORITHM,
    publicKey: keys.publicKey,
    signingKey: caKey,
    extensions,
  });

  return {
    certPem: cert.toString('pem'),
    privateKeyPem: await exportPrivateKeyPem(keys.privateKey),
  };
}
