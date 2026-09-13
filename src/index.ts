#!/usr/bin/env node
import { startServer } from "./server.js";

function parseSeedArg(argv: string[]): string | undefined {
  const flagIndex = argv.indexOf("--seed");
  if (flagIndex === -1) return undefined;
  return argv[flagIndex + 1];
}

startServer(parseSeedArg(process.argv)).catch((error) => {
  console.error("Failed to start customer-health-mcp server:", error);
  process.exit(1);
});
