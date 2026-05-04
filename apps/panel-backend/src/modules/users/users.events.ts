import { eventBus } from '../../lib/event-bus.js';

/**
 * Register all user-related event handlers.
 * Called once at app bootstrap.
 *
 * Right now handlers just log. In future slices they'll:
 *   - slice 7: enqueue node-sync jobs in BullMQ
 *   - slice 9+: call mTLS endpoints on nodes
 */
export function registerUserEventHandlers(): void {
  eventBus.on('user.created', ({ userId, username }) => {
    console.log(`[event] user.created — ${username} (${userId})`);
    // TODO slice 7: enqueue addUser to all nodes user is allowed on
  });

  eventBus.on('user.updated', ({ userId, changes }) => {
    console.log(`[event] user.updated — ${userId} — ${changes.join(', ')}`);
    // TODO slice 7: re-sync changed fields to nodes if relevant
  });

  eventBus.on('user.status-changed', ({ userId, from, to }) => {
    console.log(`[event] user.status-changed — ${userId} — ${from} → ${to}`);
    // TODO slice 7: if status went non-active → enqueue removeUser; if active → addUser
  });

  eventBus.on('user.deleted', ({ userId }) => {
    console.log(`[event] user.deleted — ${userId}`);
    // TODO slice 7: enqueue removeUser from all nodes
  });
}