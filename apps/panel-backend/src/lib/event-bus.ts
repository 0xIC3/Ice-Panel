import { EventEmitter } from 'node:events';

/**
 * All domain events in the panel.
 *
 * Naming convention: '<entity>.<action>' (past tense).
 * When adding a new event, add it here with its payload type.
 */
export interface DomainEventMap {
  'user.created':         { userId: string; username: string };
  'user.updated':         { userId: string; changes: string[] };
  'user.status-changed':  { userId: string; from: string; to: string };
  'user.deleted':         { userId: string };
  'user.traffic-reset':   { userId: string; previousUsedBytes: bigint };
  // node.created → backfill all active users to this node. Required because
  // an empty new node otherwise stays empty until each existing user is
  // mutated again. Caught live during slice-23 VPS test 2026-05-06.
  'node.created':         { nodeId: string; nodeName: string };
}

type EventHandler<K extends keyof DomainEventMap> = (
  payload: DomainEventMap[K],
) => void | Promise<void>;

/**
 * Type-safe wrapper around node:events EventEmitter.
 * - `emit` and `on` are constrained to keys of DomainEventMap.
 * - Handler errors are caught and logged so they never crash the emitter.
 */
class DomainEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Allow many handlers without warnings
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof DomainEventMap>(event: K, handler: EventHandler<K>): void {
    this.emitter.on(event, (payload: DomainEventMap[K]) => {
      void Promise.resolve()
        .then(() => handler(payload))
        .catch((err: unknown) => {
          console.error(`[event-bus] handler for "${String(event)}" threw`, err);
        });
    });
  }
}

export const eventBus = new DomainEventBus();
