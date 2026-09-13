import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PLAN_TIERS, PAYMENT_STATUSES, TICKET_SEVERITIES, TICKET_STATUSES } from "../data/types.js";
import type { Account } from "../data/types.js";
import { findAccountOrThrow } from "./shared.js";

const billingSchema = z.object({
  subscriptionId: z.string(),
  plan: z.enum(PLAN_TIERS),
  mrr: z.number(),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  seatsLicensed: z.number(),
  currentPeriodStartDaysAgo: z.number(),
  currentPeriodEndDaysAgo: z.number(),
  downgrade: z
    .object({
      fromPlan: z.enum(PLAN_TIERS),
      toPlan: z.enum(PLAN_TIERS),
      daysAgo: z.number(),
    })
    .nullable(),
});

const usageSchema = z.object({
  seatsActive: z.number(),
  lastLoginDaysAgo: z.number(),
  dailyActiveUsage: z.array(z.object({ daysAgo: z.number(), activeSeats: z.number() })),
  featureAdoption: z.array(z.object({ featureName: z.string(), adopted: z.boolean() })),
});

const ticketSchema = z.object({
  ticketId: z.string(),
  severity: z.enum(TICKET_SEVERITIES),
  status: z.enum(TICKET_STATUSES),
  createdDaysAgo: z.number(),
  resolvedDaysAgo: z.number().nullable(),
});

export function registerGetAccountDetailsTool(server: McpServer, accounts: Account[]): void {
  server.registerTool(
    "get_account_details",
    {
      title: "Get full account detail",
      description:
        "Fetch the complete raw record for one account: its Stripe-style billing/subscription " +
        "record, its full 90-day product-usage time series and feature adoption, and its full " +
        "support ticket history. Use this when you need the underlying data behind a risk score, " +
        "not just the summary. Returns a clear error if the accountId does not exist.",
      inputSchema: {
        accountId: z.string().describe("The account's unique identifier, e.g. \"acct_0007\""),
      },
      outputSchema: {
        accountId: z.string(),
        companyName: z.string(),
        billing: billingSchema,
        usage: usageSchema,
        support: z.object({ tickets: z.array(ticketSchema) }),
      },
    },
    async ({ accountId }) => {
      const account = findAccountOrThrow(accounts, accountId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(account, null, 2) }],
        structuredContent: { ...account },
      };
    }
  );
}
