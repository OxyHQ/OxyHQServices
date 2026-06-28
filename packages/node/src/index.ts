/**
 * Bootstrap for the Oxy personal data node.
 *
 * Loads env config, ensures the data directory exists, opens the SQLite store,
 * mounts the Express app, and starts listening — with graceful shutdown on
 * SIGTERM/SIGINT (drain HTTP, close the database, then exit).
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from './logger.js';
import { ConfigError, loadConfig, type NodeConfig } from './config.js';
import { NodeStore } from './store/nodeStore.js';
import { createApp } from './app.js';

function main(): void {
  const logger = createLogger();

  let config: NodeConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error({ reason: error.message }, 'invalid node configuration');
    } else {
      logger.error({ err: error }, 'failed to load node configuration');
    }
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(config.databasePath), { recursive: true });
  const store = new NodeStore(config.databasePath);
  const app = createApp({ store, config, logger });

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, mode: config.mode, databasePath: config.databasePath },
      'oxy node listening',
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    server.close((closeError) => {
      if (closeError) {
        logger.error({ err: closeError }, 'error while closing HTTP server');
      }
      store.close();
      process.exit(closeError ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
