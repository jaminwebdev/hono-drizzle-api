import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./lib/config.js";

try {
  const config = loadConfig(process.argv[2]);
  const app = createApp();

  serve(
    {
      fetch: app.fetch,
      hostname: "0.0.0.0",
      port: config.apiPort,
    },
    () => {
      console.info(`API listening on port ${config.apiPort}`);
    },
  );
} catch (error) {
  // Configuration errors name fields without printing their values.
  console.error(
    error instanceof Error ? error.message : "Unable to start the API.",
  );
  process.exitCode = 1;
}
