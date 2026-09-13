# customer-health-mcp

**[Read the build log →](https://tylerbrabo98.github.io/Customer-Health-MCP-Project/)**
A write-up covering the architecture, the scoring methodology, and three real
bugs caught along the way.

An MCP (Model Context Protocol) server that lets an AI assistant answer
customer-success questions like *"which accounts are at risk of churning?"*
or *"give me a health summary for Acme Corp"*, by synthesizing data shaped
like three real B2B SaaS systems:

1. **Billing/subscription data**, shaped like a Stripe subscription object
   (plan, MRR, payment status, downgrades)
2. **Support ticket data**, shaped like an Intercom/Zendesk ticket
   (severity, status, open duration)
3. **Product usage data**, shaped like a product analytics tool (daily active
   seats over 90 days, feature adoption, login recency)

This is a **portfolio project**: it runs with zero external API keys or
databases, using deterministic synthetic data generated from a seed at
startup. The goal is to demonstrate production-grade MCP server design (tool
granularity, input validation, structured output, error handling, and an
inspectable scoring methodology) on top of realistic (if fictional) data.

## Why this exists

Customer success teams live at the intersection of three systems that rarely
talk to each other: billing, support, and product usage. A churn signal is
almost never visible in just one of them: an account can have healthy MRR
and no open tickets while quietly not logging in for a month. This server
models that synthesis problem directly: it doesn't just expose three raw data
sources as tools, it also computes and explains a single composite risk score
from all three.

## Architecture

```
┌────────────────────────────────────────┐
│               MCP Client               │
│     (Claude Desktop / Claude Code)     │
└────────────────────────────────────────┘
                     │
                     │  stdio · JSON-RPC
                     ▼
┌────────────────────────────────────────┐
│           data/generator.ts            │
│  seeded PRNG → 32 fictional accounts,  │
│         generated once at boot         │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│      32 accounts, held in memory       │
│   billing + usage + support tickets    │
└────────────────────────────────────────┘
                     │
                     │  re-read on every tool call
                     ▼
┌────────────────────────────────────────┐
│          scoring/riskScore.ts          │
│  weights + thresholds → score, band,   │
│         drivers, never cached          │
└────────────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────┐
│          tools/ + resources/           │
│  list_accounts · get_account_details   │
│         list_at_risk_accounts          │
│        get_account_risk_summary        │
│       methodology://risk-scoring       │
└────────────────────────────────────────┘
```

Data flows one direction: the generator builds the in-memory dataset once at
startup, the scorer derives a risk score from it on demand (never cached, so
it's always consistent with the underlying data), and the tools are thin
adapters that filter/shape that data and the scorer's output for MCP clients.

## Setup

Requires Node.js 22.12+ or 24+ (this repo pins `lts/*` via `.nvmrc`).

```bash
npm install
npm run build
```

Run it directly to confirm it starts (it will sit waiting for stdio input;
`Ctrl+C` to exit):

```bash
npm start
```

Run the test suite:

```bash
npm test
```

Print a quick human-readable dump of the generated dataset without starting
the MCP server:

```bash
npm run sample-data
```

### Reproducible data with `--seed`

The dataset is generated once at startup from a seed string, so the same seed
always produces the same 32 accounts:

```bash
node dist/index.js --seed my-custom-seed
```

Omit `--seed` to use the built-in default seed.

## Wiring into Claude Desktop

Add an entry to your `claude_desktop_config.json` (on macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`; on
Windows: `%APPDATA%\Claude\claude_desktop_config.json`), pointing at the
built `dist/index.js` with an **absolute path**:

```json
{
  "mcpServers": {
    "customer-health": {
      "command": "node",
      "args": ["/absolute/path/to/customer-health-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after saving. You should see `customer-health` listed
among the connected MCP servers, with its four tools and one resource
available.

## Example prompts

Once connected, try asking Claude things like:

- *"Which of our accounts are most at risk this week, and why?"*
- *"Give me a health summary for Tidewater Insurance."*
- *"List every enterprise account that's past due on payment."*
- *"How is churn risk actually calculated here?"* (Claude can read the
  `methodology://risk-scoring` resource to answer this precisely, instead of
  guessing.)

## Design decisions

### Tool granularity: raw data tools + one synthesis tool

Three of the four tools (`list_accounts`, `get_account_details`,
`list_at_risk_accounts`) return data that's close to the underlying model:
they filter, sort, and reshape, but they don't interpret. The fourth,
`get_account_risk_summary`, is the "synthesis" tool: it's the only one that
combines all three data sources into a single judgment call (a score, a band,
and a plain-language explanation).

This split matters for how a calling model uses the server. Raw-data tools
let the model verify a claim or dig into specifics ("show me the actual
tickets"); the synthesis tool lets it answer a fuzzy question quickly without
re-deriving the scoring logic itself in-context (which it would likely do
inconsistently). Keeping them separate, rather than only exposing the
synthesized view, also makes the scoring auditable: a model (or a human
reading its answer) can always cross-check a risk summary against
`get_account_details` for the same account.

### Scoring methodology

`computeRiskScore` (in [`src/scoring/riskScore.ts`](src/scoring/riskScore.ts))
returns a 0-100 score, where higher means more risk, built from four
independently-capped categories (usage trend/dormancy, seat adoption,
support signal, and billing signal), each of which contributes plain-language
"drivers" rather than just a number. Two choices are worth calling out:

- **Billing is the highest-leverage category.** A canceled subscription alone
  is enough to reach the "at_risk" band, and a past-due payment alone is
  enough to reach "watch," because in practice a billing failure is a much
  harder churn signal than a soft dip in usage or a few open tickets. Usage
  and support signals still matter, but they combine more gradually.
- **Drivers are sorted by point contribution, not by category order.** The
  first item in `drivers` is always whatever single signal contributed the
  most to the score, so a model summarizing "why" an account is at risk leads
  with the actual biggest factor rather than an arbitrary category ordering.

The exact weights and thresholds are documented in code
(`WEIGHTS`/`BAND_THRESHOLDS` in `riskScore.ts`) and re-rendered live as the
`methodology://risk-scoring` MCP resource, so the two can never drift out of
sync with each other.

## Project structure

```
src/
  data/
    types.ts        Account/BillingRecord/Ticket/UsageProfile types
    rng.ts           seeded PRNG utilities
    generator.ts     seeded synthetic data generation
    printSample.ts   `npm run sample-data` entrypoint
  scoring/
    riskScore.ts      composite health/risk scoring logic
    riskScore.test.ts unit tests (4+ scenarios)
  tools/
    shared.ts               shared accountId lookup/error helper
    listAccounts.ts
    getAccountDetails.ts
    listAtRiskAccounts.ts
    getAccountRiskSummary.ts
  resources/
    methodology.ts    exposes scoring methodology as an MCP resource
  server.ts            wires up tools/resources into an McpServer
  index.ts              stdio entrypoint (`--seed` flag)
tests/
  integration.test.ts  real client/server round trip over InMemoryTransport
```
