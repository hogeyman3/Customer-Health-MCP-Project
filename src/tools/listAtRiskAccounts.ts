import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PLAN_TIERS, PAYMENT_STATUSES, RISK_BANDS } from "../data/types.js";
import type { Account, RiskBand } from "../data/types.js";
import { computeRiskScore } from "../scoring/riskScore.js";

const BAND_ORDER: Record<RiskBand, number> = { healthy: 0, watch: 1, at_risk: 2 };

export function registerListAtRiskAccountsTool(server: McpServer, accounts: Account[]): void {
  server.registerTool(
    "list_at_risk_accounts",
    {
      title: "List accounts at risk of churning",
      description:
        "List customer accounts whose computed churn-risk band is at or above a minimum threshold " +
        "(defaults to 'watch', so both 'watch' and 'at_risk' accounts are included), sorted by risk " +
        "score descending. This is the fastest way to answer 'which accounts are at risk this week?' " +
        "For the reasoning behind a specific account's score, follow up with get_account_risk_summary.",
      inputSchema: {
        minBand: z
          .enum(["watch", "at_risk"])
          .optional()
          .describe("Minimum risk band to include (default: 'watch')"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum number of accounts to return (default: all matches)"),
      },
      outputSchema: {
        accounts: z.array(
          z.object({
            accountId: z.string(),
            companyName: z.string(),
            plan: z.enum(PLAN_TIERS),
            mrr: z.number(),
            paymentStatus: z.enum(PAYMENT_STATUSES),
            riskBand: z.enum(RISK_BANDS),
            riskScore: z.number(),
            topDriver: z.string().nullable(),
          })
        ),
      },
    },
    async ({ minBand = "watch", limit }) => {
      const threshold = BAND_ORDER[minBand];

      const atRisk = accounts
        .map((a) => ({ account: a, risk: computeRiskScore(a) }))
        .filter(({ risk }) => BAND_ORDER[risk.band] >= threshold)
        .sort((a, b) => b.risk.score - a.risk.score);

      const limited = limit ? atRisk.slice(0, limit) : atRisk;

      const result = {
        accounts: limited.map(({ account: a, risk }) => ({
          accountId: a.accountId,
          companyName: a.companyName,
          plan: a.billing.plan,
          mrr: a.billing.mrr,
          paymentStatus: a.billing.paymentStatus,
          riskBand: risk.band,
          riskScore: risk.score,
          topDriver: risk.drivers[0] ?? null,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}
