import { fetch, Agent } from 'undici';
import type {
  AddUserRequest,
  RemoveUserRequest,
  GetStatsResponse,
  HealthcheckResponse,
  HostMetricsResponse,
  NodeErrorResponse,
  ApplyInboundsRequest,
  ApplyInboundsResponse,
} from '@ice-panel/shared';
import { bootstrapCa } from '../keygen/keygen.service.js';

const DEFAULT_TIMEOUT_MS = 10_000;

// Shared HTTPS agent for ALL panel→node calls. undici reuses TCP+TLS
// connections within an Agent's pool, so /healthz and /metrics polls hit
// every node every 15s without paying handshake cost on each tick. Built
// lazily on first call (CA material requires DB roundtrip via bootstrapCa)
// and never closed — agent lifetime = process lifetime.
//
// If the CA rotates we'd need to reset this; today the CA is bootstrapped
// once at install and is treated as immutable. Slice for cert rotation later.
let sharedAgent: Agent | null = null;
let sharedAgentPromise: Promise<Agent> | null = null;

async function getSharedAgent(
  caOverride?: { certPem: string; privateKeyPem: string },
): Promise<Agent> {
  // Test injections must always build a fresh agent — they pass
  // synthetic CAs that mustn't leak between cases.
  if (caOverride) {
    return new Agent({
      connect: {
        ca: caOverride.certPem,
        cert: caOverride.certPem,
        key: caOverride.privateKeyPem,
        rejectUnauthorized: true,
      },
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
    });
  }

  if (sharedAgent) return sharedAgent;
  if (sharedAgentPromise) return sharedAgentPromise;

  sharedAgentPromise = (async () => {
    const ca = await bootstrapCa();
    const agent = new Agent({
      connect: {
        ca: ca.certPem,
        cert: ca.certPem,
        key: ca.privateKeyPem,
        rejectUnauthorized: true,
      },
      // undici defaults are conservative for short-lived connections; we
      // want long-lived pools because we poll the same N hosts forever.
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      // Per-origin connection pool size. 2 is plenty: simultaneous calls
      // to the same node are rare (cron + occasional admin click).
      connections: 2,
    });
    sharedAgent = agent;
    return agent;
  })();
  return sharedAgentPromise;
}

/**
 * Tear down the shared agent — called on graceful shutdown so node-side
 * sockets get FIN'd cleanly instead of half-open.
 */
export async function closeNodeTransport(): Promise<void> {
  if (sharedAgent) {
    const a = sharedAgent;
    sharedAgent = null;
    sharedAgentPromise = null;
    await a.close();
  }
}

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

  private buildUrl(path: string): string {
    return `https://${this.node.address}${path}`;
  }

  private async request<TRes>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: RequestOptions = {},
  ): Promise<TRes> {
    const agent = await getSharedAgent(this.caOverride);
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
      // Test-mode override: per-call agent is short-lived, close it.
      // Production sharedAgent is process-scoped and stays open.
      if (this.caOverride) {
        await agent.close();
      }
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

  async getMetrics(): Promise<HostMetricsResponse> {
    return this.request<HostMetricsResponse>('GET', '/metrics', undefined, {
      // Metrics endpoint is local /proc reads — should be fast. Tight timeout
      // keeps the per-tick poller bounded if a node hangs.
      timeoutMs: 3_000,
    });
  }

  /**
   * Push the FULL inbound set for this node. Idempotent — node-agent diffs
   * against current state and only restarts/reloads the underlying protocol
   * server if something actually changed. Empty array is valid (means "this
   * node has no inbounds yet"); the node-agent will tear down any active
   * listener it had.
   */
  async applyInbounds(req: ApplyInboundsRequest): Promise<ApplyInboundsResponse> {
    return this.request<ApplyInboundsResponse>('POST', '/applyInbounds', req, {
      // Re-generating an Xray config + restart can take ~3-5 s; AmneziaWG
      // syncconf is faster but Caddy reload occasionally hits the LE rate
      // limiter. 30 s gives slack without making admin clicks feel hung.
      timeoutMs: 30_000,
    });
  }
}
