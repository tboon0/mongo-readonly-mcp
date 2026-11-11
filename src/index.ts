#!/usr/bin/env node
import { maskError } from "./core/json.js";

async function main(): Promise<void> {
  const [, , cmd] = process.argv;
  if (cmd === undefined || cmd === "serve") {
    const { startServer } = await import("./mcp/server.js");
    await startServer();
  } else {
    const { runCli } = await import("./cli/cli.js");
    const { closeClients } = await import("./core/mongo.js");
    try {
      await runCli(process.argv);
    } finally {
      await closeClients();
    }
  }
}

main().catch((err) => {
  console.error(maskError(err));
  process.exit(1);
});
