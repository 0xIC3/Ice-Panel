import { fetch, Agent } from 'undici';
import type {
  AddUserRequest,
  RemoveUserRequest,
  GetStatsResponse,
  HealthcheckResponse,
  NodeErrorResponse,
} from '@ice-panel/shared';
import { bootstrapCa } from '../keygen/keygen.service.js';

const DEFAULT_TIMEOUT_MS = 10_000;

export class NodeRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: NodeErrorResponse | null,
  ) {
    super(message);
    this.name = 'NodeRequestError';
  }
}

export interface NodeTransportTarget {
  /** Host[:port] without scheme (matches what's stored in `nodes.address`). */
  address: string;
}

interface RequestOptions {
  timeoutMs?: number;
}

/**
 * Panel→node mTLS REST client. One instance per outgoing call (no pooling
 * yet — calls are infrequent and each one rebuilds the TLS agent). The CA
 * material loaded via {@link bootstrapCa} is used both to verify the node's
 * server cert and (simplified for slice 9) as the panel's client cert.
 *
 * Tests can override `caOverride` to inject a known bundle without touching
 * the live `keygen_ca` table.
 */
export class NodeTransport {
  constructor(
    private readonly node: NodeTransportTarget,
    private readonly caOverride?: { certPem: string; privateKeyPem: string },
  ) {}

  private async getAgent(): Promise<Agent> {
    const ca = this.caOverride ?? (await bootstrapCa());
    return new Agent({
      connect: {
        ca: ca.certPem,
        cert: ca.certPem,
        key: ca.privateKeyPem,
        rejectUnauthorized: true,
      },
    });
  }

  private buildUrl(path: string): string {
    return `https://${this.node.address}${path}`;
  }

  private async request<TRes>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<TRes> {
    const agent = await this.getAgent();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const res = await fetch(this.buildUrl(path), {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        dispatcher: agent,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as NodeErrorResponse | null;
        throw new NodeRequestError(
          `Node ${this.node.address} returned ${res.status}: ${errBody?.message ?? res.statusText}`,
          res.status,
          errBody,
        );
      }

      if (res.status === 204) return undefined as TRes;
      return (await res.json()) as TRes;
    } finally {
      clearTimeout(timer);
      await agent.close();
    }
  }

  // ───── API methods ─────

  async addUser(req: AddUserRequest): Promise<void> {
    await this.request<void>('POST', '/addUser', req);
  }

  async removeUser(req: RemoveUserRequest): Promise<void> {
    await this.request<void>('POST', '/removeUser', req);
  }

  async getStats(): Promise<GetStatsResponse> {
    return this.request<GetStatsResponse>('GET', '/stats');
  }

  async healthcheck(): Promise<HealthcheckResponse> {
    return this.request<HealthcheckResponse>('GET', '/healthz');
  }
}
