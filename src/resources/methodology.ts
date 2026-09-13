import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WEIGHTS, BAND_THRESHOLDS } from "../scoring/riskScore.js";

const METHODOLOGY_URI = "methodology://risk-scoring";

function renderMethodology(): string {
  return `# Customer Risk Scoring Methodology

The churn-risk score is 0-100, where **higher means more risk**. It is the sum
of four independently-capped signal categories, then clamped to 100.

## Bands

| Band       | Score range |
|------------|-------------|
| healthy    | 0 - ${BAND_THRESHOLDS.watch - 1} |
| watch      | ${BAND_THRESHOLDS.watch} - ${BAND_THRESHOLDS.atRisk - 1} |
| at_risk    | ${BAND_THRESHOLDS.atRisk} - 100 |

## Categories and weights

### 1. Usage trend (max ${WEIGHTS.usage.categoryMax} pts)
- **Trend decline** (max ${WEIGHTS.usage.trendMax} pts): the fractional drop in average daily
  active seats over the last 30 days vs. the prior 30 days. No credit is given for
  usage that is flat or increasing.
- **Dormancy** (max ${WEIGHTS.usage.dormancyMax} pts): ramps from 0 points at <=3 days since the
  last login to full points at >=30 days since the last login.

### 2. Seat adoption (max ${WEIGHTS.adoption.categoryMax} pts)
Ratio of active seats to licensed seats. Full points at 0% adoption, tapering
to 0 points at 60%+ adoption — an account using most of what it pays for is
not a churn signal on this axis regardless of account size.

### 3. Support signal (max ${WEIGHTS.support.categoryMax} pts)
- **Open high/critical tickets** (max ${WEIGHTS.support.openSeverityMax} pts): 4 points per open
  high-or-critical-severity ticket.
- **Ticket volume** (max ${WEIGHTS.support.volumeMax} pts): scales with tickets-per-licensed-seat,
  flagged as a driver above a 0.15 ratio.
- **Resolution time** (max ${WEIGHTS.support.resolutionMax} pts): ramps up as the average
  resolution time for closed tickets exceeds 3 days, flagged as a driver above 10 days.

### 4. Billing signal (max ${WEIGHTS.billing.categoryMax} pts)
This is the highest-leverage category, because in practice a billing failure
is a harder churn signal than a soft dip in usage or ticket volume:
- **Canceled subscription**: ${WEIGHTS.billing.canceled} pts on its own — enough to reach "at_risk" (${BAND_THRESHOLDS.atRisk}+) by itself.
- **Past due payment**: ${WEIGHTS.billing.pastDue} pts on its own — enough to reach "watch" (${BAND_THRESHOLDS.watch}+) by itself.
- **Recent downgrade** (within 60 days): +${WEIGHTS.billing.downgrade} pts, additive with the above.

## Drivers

Alongside the score, the scorer returns a \`drivers\` list of plain-language
strings, one per triggered signal (e.g. "Account is past due on payment"),
sorted by the number of points each contributed — so the first driver is
always the single largest contributor to the score. Signals that didn't
cross their notability threshold contribute points but no driver text, so a
borderline account's total can be higher than what its listed drivers alone
would suggest.
`;
}

export function registerMethodologyResource(server: McpServer): void {
  server.registerResource(
    "risk-scoring-methodology",
    METHODOLOGY_URI,
    {
      title: "Customer risk scoring methodology",
      description:
        "Explains the weights and thresholds behind computeRiskScore: how usage, adoption, " +
        "support, and billing signals combine into a 0-100 churn-risk score and band.",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: METHODOLOGY_URI,
          mimeType: "text/markdown",
          text: renderMethodology(),
        },
      ],
    })
  );
}
