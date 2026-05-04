import { prisma } from '../../prisma.js';
import {
  generateCa,
  generateNodeCert,
  type CertBundle,
  type NodeCertOptions,
} from './keygen.crypto.js';

const SINGLETON_ID = 1;

/**
 * Payload handed to a node on registration. Encoded into a base64url blob
 * via {@link encodeNodePayload}; the node decodes it on first boot to learn
 * its identity and trust anchor.
 */
export interface NodePayload {
  nodeCertPem: string;
  nodeKeyPem: string;
  caCertPem: string;
}

/**
 * Idempotent: load the panel CA from the database, generating one on the very
 * first call. The CA never rotates automatically — operators wanting rotation
 * must wipe `keygen_ca` and re-issue every node cert.
 */
export async function bootstrapCa(): Promise<CertBundle> {
  const existing = await prisma.keygenCa.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (existing) {
    return {
      certPem: existing.certPem,
      privateKeyPem: existing.privateKeyPem,
    };
  }

  const ca = await generateCa();
  await prisma.keygenCa.create({
    data: {
      id: SINGLETON_ID,
      certPem: ca.certPem,
      privateKeyPem: ca.privateKeyPem,
    },
  });
  return ca;
}

/**
 * Issue a per-node mTLS certificate signed by the panel CA. Returns the
 * complete payload the node needs (its cert, its key, and the CA cert).
 */
export async function issueNodeCert(opts: NodeCertOptions): Promise<NodePayload> {
  const ca = await bootstrapCa();
  const nodeCert = await generateNodeCert(ca, opts);
  return {
    nodeCertPem: nodeCert.certPem,
    nodeKeyPem: nodeCert.privateKeyPem,
    caCertPem: ca.certPem,
  };
}

/**
 * Encode a node payload as a base64url JSON blob, suitable for passing as a
 * single env-var or query param to the node-agent on first boot.
 */
export function encodeNodePayload(payload: NodePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Decode a base64url payload back into structured data. Mirror of
 * {@link encodeNodePayload}; used by tests and (in slice 10) by the Go agent.
 */
export function decodeNodePayload(encoded: string): NodePayload {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as NodePayload;
}
