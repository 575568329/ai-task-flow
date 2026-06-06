// backend/src/http-server.ts
import 'reflect-metadata';
import { startHttpServer } from './interfaces/http/server.js';
import { JsonTaskRepository } from './infrastructure/persistence/JsonTaskRepository.js';
import { InMemoryEventBus } from './infrastructure/pubsub/EventBus.js';
import { JsonEventStore } from './infrastructure/pubsub/EventStore.js';
import { WorktreeManager } from './infrastructure/git/WorktreeManager.js';

async function main() {
  const eventBus = new InMemoryEventBus();
  const eventStore = new JsonEventStore();
  const taskRepository = new JsonTaskRepository(undefined, eventBus, eventStore);
  const worktreeManager = new WorktreeManager();

  const config = {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    corsOrigin: process.env.CORS_ORIGIN || '*',
  };

  await startHttpServer(config, taskRepository, eventBus, worktreeManager);
}

main().catch((error) => {
  console.error('Failed to start HTTP server:', error);
  process.exit(1);
});
