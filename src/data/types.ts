export const PLAN_TIERS = ["starter", "growth", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const PAYMENT_STATUSES = ["current", "past_due", "canceled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const TICKET_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

export const TICKET_STATUSES = ["open", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const RISK_BANDS = ["healthy", "watch", "at_risk"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/** Shaped like a Stripe subscription object. */
export interface BillingRecord {
  subscriptionId: string;
  plan: PlanTier;
  mrr: number;
  paymentStatus: PaymentStatus;
  seatsLicensed: number;
  currentPeriodStartDaysAgo: number;
  currentPeriodEndDaysAgo: number;
  /** Set when the account downgraded plans within the observed window. */
  downgrade: {
    fromPlan: PlanTier;
    toPlan: PlanTier;
    daysAgo: number;
  } | null;
}

/** A single day's active-seat count, oldest-first when read as a series. */
export interface UsageDataPoint {
  daysAgo: number;
  activeSeats: number;
}

/** Shaped like a product analytics tool's per-account usage rollup. */
export interface UsageProfile {
  seatsActive: number;
  lastLoginDaysAgo: number;
  /** Last 90 days, index 0 = 89 days ago .. index 89 = today. */
  dailyActiveUsage: UsageDataPoint[];
  featureAdoption: {
    featureName: string;
    adopted: boolean;
  }[];
}

/** Shaped like an Intercom/Zendesk support ticket. */
export interface Ticket {
  ticketId: string;
  severity: TicketSeverity;
  status: TicketStatus;
  createdDaysAgo: number;
  resolvedDaysAgo: number | null;
}

/** Shaped like a support tool's per-account ticket rollup. */
export interface SupportProfile {
  tickets: Ticket[];
}

export interface Account {
  accountId: string;
  companyName: string;
  billing: BillingRecord;
  usage: UsageProfile;
  support: SupportProfile;
}
