import { describe, expect, it } from "vitest";
import { computeRiskScore } from "./riskScore.js";
import type { Account, Ticket, UsageDataPoint } from "../data/types.js";

const USAGE_WINDOW_DAYS = 90;

/** Flat usage at `value` seats for every day in the 90-day window. */
function flatSeries(value: number): UsageDataPoint[] {
  return Array.from({ length: USAGE_WINDOW_DAYS }, (_, i) => ({
    daysAgo: USAGE_WINDOW_DAYS - 1 - i,
    activeSeats: value,
  }));
}

/** `recentValue` for the last 30 days (daysAgo 0-29), `priorValue` before that. */
function decliningSeries(recentValue: number, priorValue: number): UsageDataPoint[] {
  return Array.from({ length: USAGE_WINDOW_DAYS }, (_, i) => {
    const daysAgo = USAGE_WINDOW_DAYS - 1 - i;
    return { daysAgo, activeSeats: daysAgo < 30 ? recentValue : priorValue };
  });
}

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    ticketId: "tkt_000001",
    severity: "low",
    status: "closed",
    createdDaysAgo: 10,
    resolvedDaysAgo: 8,
    ...overrides,
  };
}

function buildAccount(overrides: {
  seatsLicensed?: number;
  seatsActive?: number;
  lastLoginDaysAgo?: number;
  dailyActiveUsage?: UsageDataPoint[];
  paymentStatus?: Account["billing"]["paymentStatus"];
  downgrade?: Account["billing"]["downgrade"];
  tickets?: Ticket[];
}): Account {
  const seatsLicensed = overrides.seatsLicensed ?? 50;
  const seatsActive = overrides.seatsActive ?? 40;
  return {
    accountId: "acct_test",
    companyName: "Test Co",
    billing: {
      subscriptionId: "sub_test",
      plan: "growth",
      mrr: 2000,
      paymentStatus: overrides.paymentStatus ?? "current",
      seatsLicensed,
      currentPeriodStartDaysAgo: 10,
      currentPeriodEndDaysAgo: -20,
      downgrade: overrides.downgrade ?? null,
    },
    usage: {
      seatsActive,
      lastLoginDaysAgo: overrides.lastLoginDaysAgo ?? 0,
      dailyActiveUsage: overrides.dailyActiveUsage ?? flatSeries(seatsActive),
      featureAdoption: [],
    },
    support: {
      tickets: overrides.tickets ?? [],
    },
  };
}

describe("computeRiskScore", () => {
  it("scores a healthy account low with no drivers", () => {
    const account = buildAccount({
      seatsLicensed: 50,
      seatsActive: 42,
      lastLoginDaysAgo: 0,
      paymentStatus: "current",
      tickets: [ticket({ severity: "low", status: "closed", createdDaysAgo: 10, resolvedDaysAgo: 8 })],
    });

    const result = computeRiskScore(account);

    expect(result.band).toBe("healthy");
    expect(result.score).toBeLessThan(30);
    expect(result.drivers).toHaveLength(0);
  });

  it("flags a declining-usage account even when billing and support are clean", () => {
    const account = buildAccount({
      seatsLicensed: 50,
      seatsActive: 8,
      lastLoginDaysAgo: 21,
      dailyActiveUsage: decliningSeries(8, 40),
      paymentStatus: "current",
      tickets: [],
    });

    const result = computeRiskScore(account);

    expect(result.band).not.toBe("healthy");
    expect(result.drivers.some((d) => d.includes("dropped"))).toBe(true);
    expect(result.drivers.some((d) => d.includes("No product login"))).toBe(true);
  });

  it("flags a billing-risk account (past due + recent downgrade) even with healthy usage", () => {
    const account = buildAccount({
      seatsLicensed: 50,
      seatsActive: 45,
      lastLoginDaysAgo: 0,
      paymentStatus: "past_due",
      downgrade: { fromPlan: "enterprise", toPlan: "growth", daysAgo: 10 },
      tickets: [],
    });

    const result = computeRiskScore(account);

    expect(result.band).not.toBe("healthy");
    expect(result.drivers).toContain("Account is past due on payment");
    expect(result.drivers.some((d) => d.includes("Downgraded from enterprise to growth"))).toBe(
      true
    );
  });

  it("accumulates a mixed-signal account (moderate usage decline + past due + open tickets) into at_risk", () => {
    const account = buildAccount({
      seatsLicensed: 60,
      seatsActive: 20,
      lastLoginDaysAgo: 15,
      dailyActiveUsage: decliningSeries(20, 45),
      paymentStatus: "past_due",
      tickets: [
        ticket({ severity: "critical", status: "open", createdDaysAgo: 5, resolvedDaysAgo: null }),
        ticket({ severity: "high", status: "open", createdDaysAgo: 3, resolvedDaysAgo: null }),
        ticket({ severity: "high", status: "closed", createdDaysAgo: 20, resolvedDaysAgo: 5 }),
      ],
    });

    const result = computeRiskScore(account);

    expect(result.band).toBe("at_risk");
    expect(result.drivers.length).toBeGreaterThan(2);
  });

  it("caps the score at 100 and orders drivers by contribution", () => {
    const account = buildAccount({
      seatsLicensed: 100,
      seatsActive: 0,
      lastLoginDaysAgo: 90,
      dailyActiveUsage: decliningSeries(0, 100),
      paymentStatus: "canceled",
      downgrade: { fromPlan: "enterprise", toPlan: "growth", daysAgo: 5 },
      tickets: [
        ticket({ severity: "critical", status: "open", createdDaysAgo: 40, resolvedDaysAgo: null }),
        ticket({ severity: "critical", status: "open", createdDaysAgo: 30, resolvedDaysAgo: null }),
        ticket({ severity: "high", status: "open", createdDaysAgo: 20, resolvedDaysAgo: null }),
      ],
    });

    const result = computeRiskScore(account);

    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.band).toBe("at_risk");
    // The canceled-subscription driver should carry the most points and sort first.
    expect(result.drivers[0]).toBe("Subscription has been canceled");
  });
});
