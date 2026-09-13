import { generateAccounts, DEFAULT_SEED } from "./generator.js";

const seed = process.argv[2] ?? DEFAULT_SEED;
const accounts = generateAccounts(seed);

console.log(`Generated ${accounts.length} accounts with seed "${seed}"\n`);

for (const a of accounts) {
  const adoption = ((a.usage.seatsActive / a.billing.seatsLicensed) * 100).toFixed(0);
  const openTickets = a.support.tickets.filter((t) => t.status === "open").length;
  const criticalOrHigh = a.support.tickets.filter(
    (t) => t.severity === "critical" || t.severity === "high"
  ).length;
  console.log(
    `${a.accountId}  ${a.companyName.padEnd(24)} plan=${a.billing.plan.padEnd(10)} ` +
      `mrr=$${String(a.billing.mrr).padEnd(6)} status=${a.billing.paymentStatus.padEnd(9)} ` +
      `seats=${a.usage.seatsActive}/${a.billing.seatsLicensed} (${adoption}%) ` +
      `lastLogin=${a.usage.lastLoginDaysAgo}d ago ` +
      `tickets=${a.support.tickets.length} (open=${openTickets}, high/crit=${criticalOrHigh}) ` +
      `downgrade=${a.billing.downgrade ? `${a.billing.downgrade.fromPlan}->${a.billing.downgrade.toPlan}@${a.billing.downgrade.daysAgo}d` : "none"}`
  );
}

const paymentCounts = accounts.reduce<Record<string, number>>((acc, a) => {
  acc[a.billing.paymentStatus] = (acc[a.billing.paymentStatus] ?? 0) + 1;
  return acc;
}, {});
console.log("\nPayment status breakdown:", paymentCounts);
