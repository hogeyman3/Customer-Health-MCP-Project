import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PLAN_TIERS, PAYMENT_STATUSES, RISK_BANDS } from "../data/types.js";
import type { Account } from "../data/types.js";
import { computeRiskScore } from "../scoring/riskScore.js";

export function registerListAccountsTool(server: McpServer, accounts: Account[]): void {
  server.registerTool(
    "list_accounts",
    {
      title: "List customer accounts",
      description:
        "List all customer accounts with their plan, MRR, payment status, and computed churn-risk " +
        "band. Supports optional filtering by plan and payment status. Use this to get an overview " +
        "of the customer base before drilling into a specific account with get_account_details or " +
        "get_account_risk_summary.",
      inputSchema: {
        plan: z
          .enum(PLAN_TIERS)
          .optional()
          .describe("Only return accounts on this subscription plan"),
        paymentStatus: z
          .enum(PAYMENT_STATUSES)
          .optional()
          .describe("Only return accounts with this billing payment status"),
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
          })
        ),
      },
    },
    async ({ plan, paymentStatus }) => {
      const filtered = accounts.filter(
        (a) =>
          (!plan || a.billing.plan === plan) &&
          (!paymentStatus || a.billing.paymentStatus === paymentStatus)
      );

      const result = {
        accounts: filtered.map((a) => {
          const risk = computeRiskScore(a);
          return {
            accountId: a.accountId,
            companyName: a.companyName,
            plan: a.billing.plan,
            mrr: a.billing.mrr,
            paymentStatus: a.billing.paymentStatus,
            riskBand: risk.band,
            riskScore: risk.score,
          };
        }),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    }
  );
}
