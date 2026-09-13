import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { DEFAULT_SEED } from "../src/data/generator.js";

// Deterministic under DEFAULT_SEED (see src/data/generator.ts): a canceled,
// fully-dark, high-ticket-volume account that should always score as at_risk.
const KNOWN_AT_RISK_ACCOUNT_ID = "acct_0014";

function parseTextResult(result: { content: unknown }): any {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text);
}

describe("customer-health-mcp server (integration)", () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer(DEFAULT_SEED);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "integration-test-client", version: "0.0.1" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("exposes all four tools and the methodology resource", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_account_details",
      "get_account_risk_summary",
      "list_accounts",
      "list_at_risk_accounts",
    ]);

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("methodology://risk-scoring");
  });

  it("list_at_risk_accounts returns a well-shaped, sorted list containing the known at-risk account", async () => {
    const result = await client.callTool({ name: "list_at_risk_accounts", arguments: {} });
    expect(result.isError).toBeFalsy();

    const data = parseTextResult(result);
    expect(Array.isArray(data.accounts)).toBe(true);
    expect(data.accounts.length).toBeGreaterThan(0);

    for (const account of data.accounts) {
      expect(account).toMatchObject({
        accountId: expect.any(String),
        companyName: expect.any(String),
        plan: expect.stringMatching(/^(starter|growth|enterprise)$/),
        mrr: expect.any(Number),
        paymentStatus: expect.stringMatching(/^(current|past_due|canceled)$/),
        riskBand: expect.stringMatching(/^(watch|at_risk)$/),
        riskScore: expect.any(Number),
      });
    }

    // Sorted by score descending.
    const scores = data.accounts.map((a: { riskScore: number }) => a.riskScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    const knownAccount = data.accounts.find(
      (a: { accountId: string }) => a.accountId === KNOWN_AT_RISK_ACCOUNT_ID
    );
    expect(knownAccount).toBeDefined();
    expect(knownAccount.riskBand).toBe("at_risk");
  });

  it("get_account_risk_summary explains why the known at-risk account is flagged", async () => {
    const result = await client.callTool({
      name: "get_account_risk_summary",
      arguments: { accountId: KNOWN_AT_RISK_ACCOUNT_ID },
    });
    expect(result.isError).toBeFalsy();

    const data = parseTextResult(result);
    expect(data.accountId).toBe(KNOWN_AT_RISK_ACCOUNT_ID);
    expect(data.riskBand).toBe("at_risk");
    expect(data.riskScore).toBeGreaterThanOrEqual(60);
    expect(data.drivers.length).toBeGreaterThan(0);
    expect(typeof data.summary).toBe("string");
    expect(data.summary).toContain(data.companyName);
  });

  it("get_account_details returns a clear error for an unknown accountId instead of crashing", async () => {
    const result = await client.callTool({
      name: "get_account_details",
      arguments: { accountId: "acct_does_not_exist" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0].text).toMatch(/no account found/i);
  });
});
