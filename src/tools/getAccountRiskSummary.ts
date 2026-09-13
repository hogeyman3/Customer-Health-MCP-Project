import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RISK_BANDS } from "../data/types.js";
import type { Account, RiskBand } from "../data/types.js";
import { computeRiskScore, type RiskScoreResult } from "../scoring/riskScore.js";
import { findAccountOrThrow } from "./shared.js";

function buildNarrativeSummary(account: Account, risk: RiskScoreResult): string {
  const topDrivers = risk.drivers.slice(0, 3);

  if (risk.band === "healthy") {
    const caveat = topDrivers.length > 0 ? ` One minor item to watch: ${topDrivers[0].toLowerCase()}.` : "";
    return (
      `${account.companyName} looks healthy overall, with a risk score of ${risk.score}/100 and no ` +
      `significant churn signals.${caveat}`
    );
  }

  const verb: Record<Exclude<RiskBand, "healthy">, string> = {
    watch: "is showing early warning signs and is worth watching closely",
    at_risk: "is at meaningful risk of churning",
  };

  const driverSentence =
    topDrivers.length > 0
      ? ` Key factors: ${topDrivers.join("; ")}.`
      : "";

  return (
    `${account.companyName} ${verb[risk.band]} ` + `(risk score ${risk.score}/100).${driverSentence}`
  );
}

export function registerGetAccountRiskSummaryTool(server: McpServer, accounts: Account[]): void {
  server.registerTool(
    "get_account_risk_summary",
    {
      title: "Get account risk summary",
      description:
        "The flagship synthesis tool: computes an account's churn-risk score and band from its " +
        "billing, usage, and support signals, lists the specific drivers behind the number, and " +
        "generates a short human-readable summary paragraph. Use this when someone asks 'why is " +
        "this account at risk?' or 'give me a health summary for <company>'. Returns a clear error " +
        "if the accountId does not exist.",
      inputSchema: {
        accountId: z.string().describe("The account's unique identifier, e.g. \"acct_0007\""),
      },
      outputSchema: {
        accountId: z.string(),
        companyName: z.string(),
        riskBand: z.enum(RISK_BANDS),
        riskScore: z.number(),
        drivers: z.array(z.string()),
        summary: z.string(),
      },
    },
    async ({ accountId }) => {
      const account = findAccountOrThrow(accounts, accountId);
      const risk = computeRiskScore(account);

      const result = {
        accountId: account.accountId,
        companyName: account.companyName,
        riskBand: risk.band,
        riskScore: risk.score,
        drivers: risk.drivers,
        summary: buildNarrativeSummary(account, risk),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}
