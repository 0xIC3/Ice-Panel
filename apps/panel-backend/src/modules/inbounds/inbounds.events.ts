import { eventBus } from '../../lib/event-bus.js';
import { prisma } from '../../prisma.js';
import { ALL_SQUAD_ID } from '../squads/squads.constants.js';
import { inboundSyncQueue } from './inbounds.queue.js';

/**
 * Register inbound-related event handlers.
 *
 * `inbound.{created,updated,deleted}` and `node.created` all collapse to a
 * single job: "recompute the full inbound set for this node and push it
 * through mTLS." Idempotent — re-firing for an unchanged set is a node-side
 * no-op, so we don't try to dedupe at the producer level.
 *
 * The job ID is per-node so multiple back-to-back inbound mutations on the
 * same node coalesce into one push instead of triggering N restarts.
 */
export function registerInboundEventHandlers(): void {
  const enqueue = (nodeId: string, reason: string): void => {
    console.log(`[event] ${reason} — enqueue applyInbounds for node ${nodeId}`);
    void inboundSyncQueue.add(
      'applyNodeInbounds',
      { nodeId },
      // Coalesce: if an `applyNodeInbounds` is already queued for this node,
      // don't add another. The currently-running one will read the latest
      // state from the DB anyway. `removeOnComplete` cleans up later.
      { jobId: `apply-${nodeId}` },
    );
  };

  eventBus.on('inbound.created', ({ inboundId, nodeId }) => {
    enqueue(nodeId, `inbound.created ${inboundId}`);
    // Slice 26 — keep the "All" squad as the universal set: every new
    // inbound is auto-attached so users in "All" continue to see everything.
    // Custom squads stay opt-in: admin must explicitly add the inbound.
    void prisma.groupInbound
      .upsert({
        where: { groupId_inboundId: { groupId: ALL_SQUAD_ID, inboundId } },
        create: { groupId: ALL_SQUAD_ID, inboundId },
        update: {},
      })
      .catch((err: unknown) => {
        console.error(`[event] failed to attach inbound ${inboundId} to All squad:`, err);
      });
  });
  eventBus.on('inbound.updated', ({ inboundId, nodeId }) => {
    enqueue(nodeId, `inbound.updated ${inboundId}`);
  });
  eventBus.on('inbound.deleted', ({ inboundId, nodeId }) => {
    enqueue(nodeId, `inbound.deleted ${inboundId}`);
  });

  // When a node is registered, also push its (currently empty) inbound set —
  // sets the node-agent into a known good state (no leftover from a previous
  // re-bootstrap) and exercises the auto-push pipeline immediately.
  eventBus.on('node.created', ({ nodeId, nodeName }) => {
    enqueue(nodeId, `node.created ${nodeName}`);
  });
}
