import { makeRng, randInt, randFloat, chance, weightedPick, shuffle, type Rng } from "./rng.js";
import { PLAN_TIERS } from "./types.js";
import type {
  Account,
  BillingRecord,
  PlanTier,
  PaymentStatus,
  Ticket,
  TicketSeverity,
  UsageDataPoint,
  UsageProfile,
} from "./types.js";

export const DEFAULT_SEED = "customer-health-mcp";
export const USAGE_WINDOW_DAYS = 90;

const COMPANY_NAMES = [
  "Acme Corp", "Northwind Analytics", "Brightloop", "Quantify Labs", "Vertex Cloud",
  "Parcel Systems", "Meridian Works", "Fathom Data", "Lumen Metrics", "Harbor Stack",
  "Ridgeline Software", "Cobalt Robotics", "Everstream", "Pinpoint HQ", "Granite Ops",
  "Nimbus Logistics", "Solace Health", "Crestwave", "Kindred Tools", "Outpost Security",
  "Ember Finance", "Talon Insights", "Waypoint Retail", "Cinder Manufacturing", "Anchorpoint",
  "Silverline CRM", "Beacon Legal", "Driftwood Media", "Ironclad Ops", "Fieldstone Realty",
  "Voxel Design", "Threadline Apparel", "Basecamp Ventures", "Lattice HR", "Skyward Freight",
  "Copper Kettle Foods", "Nova Biotech", "Hollow Creek Energy", "Pathfinder Edu", "Tidewater Insurance",
];

const FEATURES = [
  "dashboards",
  "api_access",
  "sso",
  "advanced_reporting",
  "automations",
  "integrations",
];

type Profile = "healthy" | "mixed" | "at_risk";

const PLAN_RANGES: Record<PlanTier, { mrr: [number, number]; seats: [number, number] }> = {
  starter: { mrr: [200, 800], seats: [5, 20] },
  growth: { mrr: [1000, 5000], seats: [20, 100] },
  enterprise: { mrr: [6000, 25000], seats: [100, 500] },
};

function nextPlanUp(plan: PlanTier): PlanTier | null {
  const idx = PLAN_TIERS.indexOf(plan);
  return idx > 0 ? PLAN_TIERS[idx - 1] : null;
}

function pickProfile(rng: Rng): Profile {
  return weightedPick(rng, [
    ["healthy", 0.65],
    ["mixed", 0.17],
    ["at_risk", 0.18],
  ]);
}

function generateUsageSeries(rng: Rng, profile: Profile, seatsLicensed: number): {
  series: UsageDataPoint[];
  seatsActive: number;
} {
  const adoptionRatioRange: Record<Profile, [number, number]> = {
    healthy: [0.6, 0.95],
    mixed: [0.4, 0.7],
    at_risk: [0.15, 0.5],
  };
  const [loRatio, hiRatio] = adoptionRatioRange[profile];
  const currentRatio = randFloat(rng, loRatio, hiRatio);
  const currentLevel = Math.max(0, Math.round(seatsLicensed * currentRatio));

  const trend = weightedPick<"up" | "down" | "flat">(
    rng,
    profile === "at_risk"
      ? [["down", 0.75], ["flat", 0.2], ["up", 0.05]]
      : profile === "mixed"
        ? [["down", 0.3], ["flat", 0.5], ["up", 0.2]]
        : [["down", 0.05], ["flat", 0.35], ["up", 0.6]]
  );

  // Anchor the 90-day window so it ends at currentLevel, walking backwards
  // with a trend-consistent slope plus day-to-day and weekend noise.
  const swing = randFloat(rng, 0.15, 0.45) * seatsLicensed;
  const startLevel =
    trend === "down"
      ? currentLevel + swing
      : trend === "up"
        ? Math.max(0, currentLevel - swing)
        : currentLevel;

  const series: UsageDataPoint[] = [];
  for (let i = 0; i < USAGE_WINDOW_DAYS; i++) {
    const daysAgo = USAGE_WINDOW_DAYS - 1 - i;
    const progress = i / (USAGE_WINDOW_DAYS - 1);
    const base = startLevel + (currentLevel - startLevel) * progress;
    const dayOfWeek = daysAgo % 7;
    const weekendDip = dayOfWeek === 0 || dayOfWeek === 6 ? 0.6 : 1;
    const noise = randFloat(rng, -0.12, 0.12) * seatsLicensed;
    const value = Math.max(0, Math.min(seatsLicensed, Math.round((base + noise) * weekendDip)));
    series.push({ daysAgo, activeSeats: value });
  }

  // A subset of struggling accounts don't just decline gradually — they go
  // fully dark (nobody logs in) for a real stretch, which is what makes
  // lastLoginDaysAgo a meaningful, independent risk signal rather than
  // always reading ~0.
  const goesDarkChance = profile === "at_risk" ? 0.45 : profile === "mixed" ? 0.1 : 0;
  if (chance(rng, goesDarkChance)) {
    const darkDays = randInt(rng, 5, 45);
    for (const point of series) {
      if (point.daysAgo < darkDays) point.activeSeats = 0;
    }
  }

  // seatsActive is a smoothed "current" snapshot (avg of the last 7 days) so
  // a single weekend day doesn't read as a churn signal on its own.
  const recentWindow = series.filter((p) => p.daysAgo < 7);
  const seatsActive = Math.round(
    recentWindow.reduce((sum, p) => sum + p.activeSeats, 0) / recentWindow.length
  );

  return { series, seatsActive };
}

function deriveLastLoginDaysAgo(series: UsageDataPoint[]): number {
  // series is ordered oldest-first (daysAgo descending); scan from the most
  // recent day backwards to find the smallest daysAgo with any activity.
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].activeSeats > 0) return series[i].daysAgo;
  }
  return USAGE_WINDOW_DAYS;
}

function generateBilling(
  rng: Rng,
  profile: Profile,
  accountId: string
): { billing: Omit<BillingRecord, "seatsLicensed">; seatsLicensed: number; plan: PlanTier } {
  const plan = weightedPick<PlanTier>(rng, [
    ["starter", 0.4],
    ["growth", 0.4],
    ["enterprise", 0.2],
  ]);
  const { mrr: mrrRange, seats: seatRange } = PLAN_RANGES[plan];
  const mrr = Math.round(randFloat(rng, mrrRange[0], mrrRange[1]));
  const seatsLicensed = randInt(rng, seatRange[0], seatRange[1]);

  const paymentStatusByProfile: Record<Profile, [PaymentStatus, number][]> = {
    healthy: [["current", 0.96], ["past_due", 0.04]],
    mixed: [["current", 0.75], ["past_due", 0.25]],
    at_risk: [["current", 0.35], ["past_due", 0.55], ["canceled", 0.1]],
  };
  const paymentStatus = weightedPick(rng, paymentStatusByProfile[profile]);

  const downgradeChance = profile === "at_risk" ? 0.4 : profile === "mixed" ? 0.15 : 0.03;
  const fromPlan = nextPlanUp(plan);
  const downgrade =
    fromPlan && chance(rng, downgradeChance)
      ? { fromPlan, toPlan: plan, daysAgo: randInt(rng, 3, 60) }
      : null;

  const currentPeriodStartDaysAgo = randInt(rng, 0, 29);
  const currentPeriodEndDaysAgo = currentPeriodStartDaysAgo - 30;

  return {
    billing: {
      subscriptionId: `sub_${accountId.slice(5)}`,
      plan,
      mrr,
      paymentStatus,
      currentPeriodStartDaysAgo,
      currentPeriodEndDaysAgo,
      downgrade,
    },
    seatsLicensed,
    plan,
  };
}

function generateTickets(rng: Rng, profile: Profile): Ticket[] {
  const countRange: Record<Profile, [number, number]> = {
    healthy: [0, 3],
    mixed: [2, 6],
    at_risk: [4, 12],
  };
  const [lo, hi] = countRange[profile];
  const count = randInt(rng, lo, hi);

  const severityWeights: Record<Profile, [TicketSeverity, number][]> = {
    healthy: [["low", 0.55], ["medium", 0.35], ["high", 0.09], ["critical", 0.01]],
    mixed: [["low", 0.35], ["medium", 0.35], ["high", 0.22], ["critical", 0.08]],
    at_risk: [["low", 0.15], ["medium", 0.25], ["high", 0.35], ["critical", 0.25]],
  };
  const openChance = profile === "at_risk" ? 0.55 : profile === "mixed" ? 0.3 : 0.15;

  const tickets: Ticket[] = [];
  for (let i = 0; i < count; i++) {
    const createdDaysAgo = randInt(rng, 1, USAGE_WINDOW_DAYS);
    const isOpen = chance(rng, openChance);
    const resolvedDaysAgo = isOpen ? null : randInt(rng, 0, createdDaysAgo - 1);
    tickets.push({
      ticketId: `tkt_${randInt(rng, 100000, 999999)}`,
      severity: weightedPick(rng, severityWeights[profile]),
      status: isOpen ? "open" : "closed",
      createdDaysAgo,
      resolvedDaysAgo,
    });
  }
  return tickets;
}

function generateFeatureAdoption(rng: Rng, profile: Profile): UsageProfile["featureAdoption"] {
  const adoptionChance = profile === "healthy" ? 0.75 : profile === "mixed" ? 0.5 : 0.25;
  return FEATURES.map((featureName) => ({
    featureName,
    adopted: chance(rng, adoptionChance),
  }));
}

export function generateAccounts(seed: string | number = DEFAULT_SEED, count = 32): Account[] {
  const rng = makeRng(seed);
  const names = shuffle(rng, COMPANY_NAMES).slice(0, Math.min(count, COMPANY_NAMES.length));

  return names.map((companyName, i) => {
    const accountId = `acct_${String(i + 1).padStart(4, "0")}`;
    const profile = pickProfile(rng);

    const { billing, seatsLicensed } = generateBilling(rng, profile, accountId);
    const { series, seatsActive } = generateUsageSeries(rng, profile, seatsLicensed);

    const account: Account = {
      accountId,
      companyName,
      billing: { ...billing, seatsLicensed },
      usage: {
        seatsActive,
        lastLoginDaysAgo: deriveLastLoginDaysAgo(series),
        dailyActiveUsage: series,
        featureAdoption: generateFeatureAdoption(rng, profile),
      },
      support: {
        tickets: generateTickets(rng, profile),
      },
    };
    return account;
  });
}
