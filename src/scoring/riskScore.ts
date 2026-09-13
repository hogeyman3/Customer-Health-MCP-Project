import type { Account, RiskBand, Ticket } from "../data/types.js";

/**
 * Composite risk scoring methodology.
 *
 * The score is 0-100, where HIGHER = MORE risk of churn. It's built from four
 * independently-capped signal categories so no single bad metric can dominate
 * the total, and each category exposes plain-language "drivers" explaining
 * what pushed the number up. Weights were chosen so that billing/payment
 * problems (the strongest churn predictor in practice) can alone push an
 * account into "at_risk", while usage/support signals combine more gradually.
 *
 * This module is also exported as-is for the `methodology://risk-scoring`
 * MCP resource, so the weights and thresholds below are the single source of
 * truth for both the scorer and its documentation.
 *
 * Billing is deliberately the highest-leverage category: a canceled
 * subscription alone (60 pts) clears the "at_risk" bar (60), and a past-due
 * account alone (32 pts) clears "watch" (30) — because in practice a billing
 * failure is a harder churn signal than a soft dip in usage or ticket volume,
 * and each of those on their own should not be able to reach "at_risk".
 */
export const WEIGHTS = {
  usage: { categoryMax: 30, trendMax: 18, dormancyMax: 12 },
  adoption: { categoryMax: 20 },
  support: { categoryMax: 25, openSeverityMax: 12, volumeMax: 8, resolutionMax: 5 },
  billing: { categoryMax: 70, pastDue: 32, canceled: 60, downgrade: 10 },
} as const;

export const BAND_THRESHOLDS = {
  /** score < watch -> "healthy" */
  watch: 30,
  /** score >= watch and < atRisk -> "watch"; score >= atRisk -> "at_risk" */
  atRisk: 60,
} as const;

export interface RiskScoreResult {
  score: number;
  band: RiskBand;
  drivers: string[];
}

interface WeightedDriver {
  points: number;
  text: string;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function meanActiveSeats(account: Account, daysAgoLessThan: number, daysAgoAtLeast = 0): number {
  const points = account.usage.dailyActiveUsage.filter(
    (p) => p.daysAgo >= daysAgoAtLeast && p.daysAgo < daysAgoLessThan
  );
  if (points.length === 0) return 0;
  return points.reduce((sum, p) => sum + p.activeSeats, 0) / points.length;
}

function scoreUsage(account: Account): { points: number; drivers: WeightedDriver[] } {
  const avgRecent = meanActiveSeats(account, 30, 0);
  const avgPrior = meanActiveSeats(account, 60, 30);

  // Fraction decline over the last 30 days vs. the prior 30 days, clamped to
  // [0, 1] (a rise contributes 0, never a negative/"bonus" risk points).
  const decline = avgPrior > 0 ? clamp01(1 - avgRecent / avgPrior) : avgRecent > 0 ? 0 : 0;
  const trendPoints = decline * WEIGHTS.usage.trendMax;

  // Dormancy ramps from 0 points at <=3 days since last login to full points
  // at >=30 days; a completely dark account is a strong signal on its own.
  const dormancyRatio = clamp01((account.usage.lastLoginDaysAgo - 3) / 27);
  const dormancyPoints = dormancyRatio * WEIGHTS.usage.dormancyMax;

  const drivers: WeightedDriver[] = [];
  if (decline >= 0.15) {
    drivers.push({
      points: trendPoints,
      text: `Usage has dropped ${Math.round(decline * 100)}% over the last 30 days`,
    });
  }
  if (account.usage.lastLoginDaysAgo >= 14) {
    drivers.push({
      points: dormancyPoints,
      text: `No product login in ${account.usage.lastLoginDaysAgo} days`,
    });
  }

  return { points: trendPoints + dormancyPoints, drivers };
}

function scoreAdoption(account: Account): { points: number; drivers: WeightedDriver[] } {
  const { seatsActive } = account.usage;
  const { seatsLicensed } = account.billing;
  const adoptionRatio = seatsLicensed > 0 ? seatsActive / seatsLicensed : 0;

  // Full points at 0% adoption, tapering to 0 points at 60%+ adoption.
  const points = clamp01(1 - adoptionRatio / 0.6) * WEIGHTS.adoption.categoryMax;

  const drivers: WeightedDriver[] = [];
  if (adoptionRatio < 0.5) {
    drivers.push({
      points,
      text: `Only ${Math.round(adoptionRatio * 100)}% of licensed seats are active`,
    });
  }
  return { points, drivers };
}

function scoreSupport(account: Account): { points: number; drivers: WeightedDriver[] } {
  const tickets = account.support.tickets;
  const seatsLicensed = Math.max(1, account.billing.seatsLicensed);

  const openHighSeverity = tickets.filter(
    (t) => t.status === "open" && (t.severity === "high" || t.severity === "critical")
  );
  const openSeverityPoints = Math.min(
    openHighSeverity.length * 4,
    WEIGHTS.support.openSeverityMax
  );

  const ticketsPerSeat = tickets.length / seatsLicensed;
  const volumePoints = Math.min(ticketsPerSeat * 40, WEIGHTS.support.volumeMax);

  const resolved = tickets.filter(
    (t): t is Ticket & { resolvedDaysAgo: number } =>
      t.status === "closed" && t.resolvedDaysAgo !== null
  );
  const avgResolutionDays =
    resolved.length > 0
      ? resolved.reduce((sum, t) => sum + (t.createdDaysAgo - t.resolvedDaysAgo), 0) /
        resolved.length
      : 0;
  const resolutionPoints = clamp01((avgResolutionDays - 3) / 17) * WEIGHTS.support.resolutionMax;

  const drivers: WeightedDriver[] = [];
  if (openHighSeverity.length > 0) {
    drivers.push({
      points: openSeverityPoints,
      text: `${openHighSeverity.length} open high/critical severity ticket${
        openHighSeverity.length === 1 ? "" : "s"
      }`,
    });
  }
  if (ticketsPerSeat > 0.15) {
    drivers.push({
      points: volumePoints,
      text: "High support ticket volume relative to account size",
    });
  }
  if (resolved.length > 0 && avgResolutionDays > 10) {
    drivers.push({
      points: resolutionPoints,
      text: `Tickets take an average of ${Math.round(avgResolutionDays)} days to resolve`,
    });
  }

  return { points: openSeverityPoints + volumePoints + resolutionPoints, drivers };
}

function scoreBilling(account: Account): { points: number; drivers: WeightedDriver[] } {
  const { paymentStatus, downgrade } = account.billing;

  let statusPoints = 0;
  const drivers: WeightedDriver[] = [];
  if (paymentStatus === "past_due") {
    statusPoints = WEIGHTS.billing.pastDue;
    drivers.push({ points: statusPoints, text: "Account is past due on payment" });
  } else if (paymentStatus === "canceled") {
    statusPoints = WEIGHTS.billing.canceled;
    drivers.push({ points: statusPoints, text: "Subscription has been canceled" });
  }

  let downgradePoints = 0;
  if (downgrade && downgrade.daysAgo <= 60) {
    downgradePoints = WEIGHTS.billing.downgrade;
    drivers.push({
      points: downgradePoints,
      text: `Downgraded from ${downgrade.fromPlan} to ${downgrade.toPlan} ${downgrade.daysAgo} days ago`,
    });
  }

  const points = Math.min(statusPoints + downgradePoints, WEIGHTS.billing.categoryMax);
  return { points, drivers };
}

function bandForScore(score: number): RiskBand {
  if (score >= BAND_THRESHOLDS.atRisk) return "at_risk";
  if (score >= BAND_THRESHOLDS.watch) return "watch";
  return "healthy";
}

export function computeRiskScore(account: Account): RiskScoreResult {
  const usage = scoreUsage(account);
  const adoption = scoreAdoption(account);
  const support = scoreSupport(account);
  const billing = scoreBilling(account);

  const rawScore = usage.points + adoption.points + support.points + billing.points;
  const score = Math.round(clamp01(rawScore / 100) * 100);

  const drivers = [...usage.drivers, ...adoption.drivers, ...support.drivers, ...billing.drivers]
    .sort((a, b) => b.points - a.points)
    .map((d) => d.text);

  return { score, band: bandForScore(score), drivers };
}
