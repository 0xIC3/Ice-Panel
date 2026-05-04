import { Queue, Worker, type Job } from 'bullmq';
import { redis } from '../../lib/redis.js';

// ───── Job data shapes ─────

export interface AddUserJobData {
  userId: string;
}

export interface RemoveUserJobData {
  userId: string;
}

export type NodeUserJobData = AddUserJobData | RemoveUserJobData;

// ───── Queue ─────

const QUEUE_NAME = 'node-users';

export const nodeUsersQueue = new Queue<NodeUserJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },     // 1s, 2s, 4s
    removeOnComplete: { age: 3600, count: 1000 },      // keep 1h or last 1000
    removeOnFail: { age: 86400 },                      // keep 24h on fail
  },
});

// ───── Worker (in-process for now; can be split into worker process later) ─────

export function startNodeUsersWorker(): Worker<NodeUserJobData> {
  return new Worker<NodeUserJobData>(
    QUEUE_NAME,
    async (job: Job<NodeUserJobData>) => {
      switch (job.name) {
        case 'addUser': {
          const { userId } = job.data as AddUserJobData;
          // TODO slice 9: send mTLS POST /addUser to all nodes user has access to
          console.log(`[worker:node-users] addUser ${userId} (mock — no nodes yet)`);
          break;
        }
        case 'removeUser': {
          const { userId } = job.data as RemoveUserJobData;
          // TODO slice 9: send mTLS POST /removeUser to all nodes
          console.log(`[worker:node-users] removeUser ${userId} (mock — no nodes yet)`);
          break;
        }
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );
}