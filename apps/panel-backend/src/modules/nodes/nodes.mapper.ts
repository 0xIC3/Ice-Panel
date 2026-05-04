import type { Node } from '../../generated/prisma/client.js';

export interface PublicNodeDto {
  id: string;
  name: string;
  address: string;
  countryCode: string | null;
  status: string;
  lastStatusChange: string | null;
  lastStatusMessage: string | null;
  consumptionMultiplier: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public DTO for a node — strips internal cert/key material and lifecycle
 * fields (deletedAt, publicKey blob).
 */
export function mapNodeToPublic(node: Node): PublicNodeDto {
  return {
    id: node.id,
    name: node.name,
    address: node.address,
    countryCode: node.countryCode,
    status: node.status,
    lastStatusChange: node.lastStatusChange?.toISOString() ?? null,
    lastStatusMessage: node.lastStatusMessage,
    consumptionMultiplier: node.consumptionMultiplier.toString(),
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  };
}

export interface CreateNodeResponseDto extends PublicNodeDto {
  /**
   * Base64url-encoded one-time payload containing the node's mTLS cert+key
   * and the panel CA. This is the ONLY moment the key is exposed — admin
   * must hand it to the node-agent at first boot and store securely.
   */
  payload: string;
}

export function mapNodeWithPayload(node: Node, payload: string): CreateNodeResponseDto {
  return { ...mapNodeToPublic(node), payload };
}
