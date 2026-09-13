import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { generateAccounts, DEFAULT_SEED } from "./data/generator.js";
import { registerListAccountsTool } from "./tools/listAccounts.js";
import { registerGetAccountDetailsTool } from "./tools/getAccountDetails.js";
import { registerListAtRiskAccountsTool } from "./tools/listAtRiskAccounts.js";
import { registerGetAccountRiskSummaryTool } from "./tools/getAccountRiskSummary.js";
import { registerMethodologyResource } from "./resources/methodology.js";

export const SERVER_NAME = "customer-health-mcp";
export const SERVER_VERSION = "0.1.0";

/** Builds a fully-wired server instance over a freshly generated (seeded) dataset. */
export function createServer(seed: string | number = DEFAULT_SEED): McpServer {
  const accounts = generateAccounts(seed);

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerListAccountsTool(server, accounts);
  registerGetAccountDetailsTool(server, accounts);
  registerListAtRiskAccountsTool(server, accounts);
  registerGetAccountRiskSummaryTool(server, accounts);
  registerMethodologyResource(server);

  return server;
}

export async function startServer(seed?: string | number): Promise<void> {
  const server = createServer(seed);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
