import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./lib/config.js";
import { createDatabase } from "./db/client.js";
import { createShutdown } from "./lib/shutdown.js";

try {
  const config = loadConfig(process.argv[2]);
  const database = createDatabase(config.database);
  let closing = false;
  const app = createApp({
    checkDatabase: () => database.checkConnection(),
    isShuttingDown: () => closing,
  });

  const server = serve(
    {
      fetch: app.fetch,
      hostname: "0.0.0.0",
      port: config.apiPort,
    },
    () => {
      console.info(`API listening on port ${config.apiPort}`);
    },
  );

  const shutdown = createShutdown({
    markClosing: () => { closing = true; },
    stopHttp: () => new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
    closeDatabase: database.close,
  });

  const handleShutdown = () => {
    void shutdown().then(() => {
      console.info('HTTP server and database pool closed.');
    }).catch(() => {
      console.error('Unable to close the HTTP server and database pool.');
      process.exit(1);
    });
  };

  process.once('SIGTERM', handleShutdown);
  process.once('SIGINT', handleShutdown);
  server.on('error', () => {
    console.error('HTTP server failed.');
    process.exitCode = 1;
    handleShutdown();
  });
} catch (error) {
  // Configuration errors name fields without printing their values.
  console.error(
    error instanceof Error ? error.message : "Unable to start the API.",
  );
  process.exitCode = 1;
}
