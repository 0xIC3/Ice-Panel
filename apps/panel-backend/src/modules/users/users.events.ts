import { eventBus } from '../../lib/event-bus.js';
import { nodeUsersQueue } from './users.queue.js';

/**
 * Register all user-related event handlers.
 * Called once at app bootstrap.
 *
 * Handlers translate domain events into background jobs (BullMQ).
 * The actual node sync happens in workers (slice 9 will implement
 * the mTLS calls). For now workers are mock log-only.
 */
export function registerUserEventHandlers(): void {
  eventBus.on('user.created', async ({ userId, username }) => {
    console.log(`[event] user.created — ${username} (${userId})`);
    await nodeUsersQueue.add('addUser', { userId });
  });

  eventBus.on('user.updated', ({ userId, changes }) => {
    console.log(`[event] user.updated — ${userId} — ${changes.join(', ')}`);
    // No node sync needed for pure metadata updates (description, tag, email, etc.)
    // Status changes have their own event below.
  });

  eventBus.on('user.status-changed', async ({ userId, from, to }) => {
    console.log(`[event] user.status-changed — ${userId} — ${from} → ${to}`);
    // Going non-active → remove user from nodes
    if (to === 'disabled' || to === 'limited' || to === 'expired') {
      await nodeUsersQueue.add('removeUser', { userId });
    }
    // Going back to active → re-add to nodes
    if (to === 'active' && from !== 'active') {
      await nodeUsersQueue.add('addUser', { userId });
    }
  });

  eventBus.on('user.deleted', async ({ userId }) => {
    console.log(`[event] user.deleted — ${userId}`);
    await nodeUsersQueue.add('removeUser', { userId });
  });
}
