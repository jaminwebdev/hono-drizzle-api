import { createApi } from "./api.js";
import { createApp } from "./app.js";
import { loadConfig } from "./lib/config.js";
import { createDatabase } from "./db/client.js";
import { createShutdown } from "./lib/shutdown.js";

try {
  const config = loadConfig(process.argv[2]);
  const database = createDatabase(config.database);
  let closing = false;
  const app = createApp({
    apiRoutes: createApi(database.db),
    corsOrigins: config.corsOrigins,
    findOwner: (id) => database.findOwner(id),
    checkDatabase: () => database.checkConnection(),
    isShuttingDown: () => closing,
  });

  const server = Bun.serve({
    fetch: app.fetch,
    hostname: config.environment === "local" ? "127.0.0.1" : "0.0.0.0",
    port: config.apiPort,
  });
  console.info(`API listening on port ${server.port}`);

  const shutdown = createShutdown({
    markClosing: () => { closing = true; },
    stopHttp: async () => { await server.stop(); },
    closeDatabase: database.close,
  });

  const handleShutdown = () => {
    void shutdown().then(() => {
      console.info('HTTP server and database pool closed.');
      // Watch mode keeps the process alive after the HTTP server closes.
      process.exit(0);
    }).catch(() => {
      console.error('Unable to close the HTTP server and database pool.');
      process.exit(1);
    });
  };

  process.once('SIGTERM', handleShutdown);
  process.once('SIGINT', handleShutdown);
} catch (error) {
  // Configuration errors name fields without printing their values.
  console.error(
    error instanceof Error ? error.message : "Unable to start the API.",
  );
  process.exitCode = 1;
}
