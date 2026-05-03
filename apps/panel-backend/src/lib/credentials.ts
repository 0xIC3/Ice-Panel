import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';

/**
 * Random URL-safe string of approximately N*4/3 characters.
 * Uses base64url (no '+', '/', or padding).
 */
function randomUrlSafe(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}

/**
 * Generate a Curve25519 (X25519) keypair for WireGuard / AmneziaWG.
 * Both keys are 32 raw bytes encoded as standard base64.
 *
 * Implementation: Node exports X25519 keys in DER format (PKCS8 for private,
 * SPKI for public). The actual 32-byte key is at the END of the DER blob —
 * so we slice the last 32 bytes.
 */
export function generateWireguardKeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');

  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });

  return {
    privateKey: privDer.subarray(privDer.length - 32).toString('base64'),
    publicKey: pubDer.subarray(pubDer.length - 32).toString('base64'),
  };
}

/**
 * All credentials/identifiers generated when creating a new user.
 */
export interface UserCredentials {
  hysteriaPassword: string;
  naivePassword: string;
  xrayUuid: string;
  amneziawgPrivateKey: string;
  amneziawgPublicKey: string;
  subscriptionToken: string;
  shortId: string;
}

export function generateUserCredentials(): UserCredentials {
  const wg = generateWireguardKeyPair();

  return {
    hysteriaPassword:    randomUrlSafe(24),  // ~32 chars
    naivePassword:       randomUrlSafe(24),  // ~32 chars
    xrayUuid:            randomUUID(),
    amneziawgPrivateKey: wg.privateKey,
    amneziawgPublicKey:  wg.publicKey,
    subscriptionToken:   randomUrlSafe(32),  // ~43 chars
    shortId:             randomUrlSafe(8),   // ~11 chars
  };
}