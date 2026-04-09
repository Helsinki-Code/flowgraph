# Token Flame Graph ðŸ”¥

**CPU profiler for AI agent sessions** â€” Visualize exactly where tokens burn and optimize your LLM spend.

A drop-in instrumentation wrapper for [`@mariozechner/pi-agent-core`](https://github.com/badlogic/pi-mono) that captures every LLM call, tool execution, and context window event, then renders a **flame graph** showing cost, tokens, and duration at the call level.

---

## The Problem

70% of tokens in agent sessions are wasted:
- **35â€“45%** on file reading and search
- **15â€“25%** on tool output (JSON bloat, noise)
- **15â€“20%** on context re-sending (duplicated messages)
- **5â€“15%** on actual code generation

**Nobody can see where.** This tool makes it visible.

---

## What You Get

1. **Drop-in SDK** â€” Wrap any pi-agent `Agent` in one line
2. **Flame Graph Dashboard** â€” D3-powered interactive visualization of token burn
3. **Cost Attribution** â€” See costs grouped by tool, model, feature, engineer, PR
4. **Loop Detection** â€” Automatic alerts for infinite tool calls
5. **Team Insights** â€” Who/what is burning budget? Drill down to the turn level

---

## Quick Start

### Installation

```bash
npm install flamegraph-sdk @flamegraph/storage

# or with pnpm
pnpm add flamegraph-sdk @flamegraph/storage
```

### Usage

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { instrumentAgent, LocalCollector } from "flamegraph-sdk";

// Create agent as usual
const agent = new Agent({
  model: "claude-opus-4-6",
  tools: [/* your tools */],
});

// Wrap with instrumentation
const collector = new LocalCollector();
const unsubscribe = instrumentAgent(agent, {
  collector,
  workspaceId: "my-workspace",
  feature: "search-bar",
  engineerId: "alice",
});

// Run agent normally
await agent.prompt("Find all users in the database");

// Get events for analysis
const events = collector.getEvents();
console.log(events);
```

---

## Project Structure

```
token-flamegraph/
â”œâ”€â”€ packages/
â”‚   â”œâ”€â”€ sdk/               # Drop-in instrumentation wrapper
â”‚   â”œâ”€â”€ storage/           # SQLite (local) + PostgreSQL (cloud) storage
â”‚   â”œâ”€â”€ server/            # Fastify API server for event ingestion
â”‚   â””â”€â”€ web/               # Astro dashboard with D3 flame graph
â””â”€â”€ README.md
```

### `packages/sdk`

Zero-dependency instrumentation. Hooks into `Agent.subscribe()` and `transformContext` to capture:
- Every LLM call with full token counts and costs
- Every tool execution (input/output sizes, errors)
- Context window build time per turn
- Session lifecycle

**No changes to pi-mono code required.**

### `packages/storage`

SQLite (development) and PostgreSQL (production) adapters. Implements:
- Schema with sessions, events, alerts, workspaces
- Cost breakdown queries (by tool, model, feature, engineer)
- Loop detection algorithm (tool called 3+ times â†’ flag)

### `packages/server`

Fastify API server with routes:
- `POST /v1/events` â€” SDK â†’ server event ingest
- `GET /v1/sessions` â€” paginated session list
- `GET /v1/sessions/:id` â€” session detail + all events
- `GET /v1/sessions/:id/flamegraph` â€” flame tree (D3-ready JSON)
- `GET /v1/cost/breakdown` â€” cost attribution
- `GET/POST /v1/alerts` â€” alert config + history

### `packages/web`

Astro + React dashboard:
- **Sessions** â€” Table with cost, tokens, loop warnings
- **Session Detail** â€” D3 flame graph + cost breakdown
- **Cost Analysis** â€” Grouped by tool/model/feature/engineer
- **Alerts** â€” Configure cost/loop alerts
- **Billing** â€” Stripe subscription management

---

## Development

### Install Dependencies

```bash
npm install
```

### Run All Services Locally

```bash
# Terminal 1: API server
npm run dev --workspace=packages/server

# Terminal 2: Web dashboard
npm run dev --workspace=packages/web

# Terminal 3: Test SDK instrumentation
npm run test --workspace=packages/sdk
```

Visit `http://localhost:3000` (web) and `http://localhost:3001` (server).

### Run Tests

```bash
npm test
```

### Security Guardrails

```bash
# one-time: install local git hook
npm run prepare

# run secret scan manually
npm run secret:scan
```

See [SECURITY_ROTATION.md](./SECURITY_ROTATION.md) for production key rotation and incident response steps.

---

## Integration with pi-mono

The SDK is a **pure wrapper** â€” no fork, no modifications. It uses pi-mono as an npm dependency:

```json
{
  "peerDependencies": {
    "@mariozechner/pi-agent-core": "0.65.2",
    "@mariozechner/pi-ai": "0.65.2"
  }
}
```

Works with any version of pi-mono. Subscribe to `Agent.subscribe()` events (public API) to capture all instrumentation.

---

## API

### `instrumentAgent(agent, options)`

```typescript
function instrumentAgent(
  agent: Agent,
  options: {
    collector: EventCollector;
    workspaceId: string;
    feature?: string;
    prNumber?: string;
    engineerId?: string;
    projectId?: string;
  },
): () => void // unsubscribe function
```

Hooks into the agent and collects events. Returns unsubscribe function.

### `LocalCollector`

```typescript
const collector = new LocalCollector({
  autoFlushIntervalMs: 5000, // optional
});

collector.getEvents(); // all events so far
collector.clear();     // reset
collector.destroy();   // cleanup (stop auto-flush)
```

### Event Types

See `packages/sdk/src/event-model.ts` for the full `FlamegraphEvent` schema. Each event has:
- `kind`: "session" | "turn" | "llm_call" | "tool_exec" | "context_build"
- `sessionId`, `parentId` (for tree nesting)
- Token counts, cost, timing, attribution fields
- Metadata for custom data

---

## Flame Graph Format

The flame tree is a recursive JSON structure:

```typescript
interface FlameNode {
  id: string;
  name: string; // "turn:3", "bash", "llm:claude-opus-4-6"
  kind: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  costUsd: number;
  tokens: number;
  pctOfTotal: number; // % of session total
  children: FlameNode[];
  loopFlag?: boolean; // if tool called 3+ times
  isError?: boolean;
}
```

Returned by `GET /v1/sessions/:id/flamegraph`. Ready for D3 visualization.

---

## Pricing & Monetization

### Plans

| Feature | Free | Pro | Business |
|---|---|---|---|
| Sessions/month | 100 | 5,000 | Unlimited |
| Retention | 7 days | 90 days | 365 days |
| Cost alerts | âœ— | âœ“ | âœ“ |
| Team members | 1 | 5 | Unlimited |
| API access | âœ— | âœ— | âœ“ |
| Price | Free | $49/mo | $299/mo |

Enforcement via workspace middleware: check session count against plan quota on ingest.

---

## Roadmap

- [ ] PostgreSQL adapter (production)
- [ ] Clerk authentication
- [ ] Stripe billing integration
- [ ] Advanced D3 flame graph (zoom, time slider, search)
- [ ] Slack webhook alerts
- [ ] CSV/JSON export
- [ ] API key management
- [ ] Team invitations

---

## Architecture Decisions

### Why D3 Over Recharts?

D3 is lower-level, which is necessary for:
- Custom flame graph layout (time on X, depth on Y)
- Performance with 100+ events (Recharts re-renders all)
- Tooltip/tooltip coordination across levels

### Why Fastify?

- Fast JSON parsing and serialization
- Built-in schema validation
- Easy to extend with plugins (auth, CORS, etc.)
- Lighter than Express for serverless

### Why Astro?

- SSR by default (zero JS sent to client by default)
- Island architecture (React only where needed)
- File-based routing
- Tailwind CSS built-in

### Why No GraphQL?

Simple REST is sufficient for the queries. When/if we add complex filtering, GraphQL can be added.

---

## Contributing

PRs welcome. Please:
1. Test your changes locally with `npm test`
2. Run `npm run lint` and `npm run format`
3. Keep the SDK minimal (no breaking changes to public API)

---

## License

MIT. Built on pi-mono (also MIT).

---

## Related

- **pi-mono** â€” [`github.com/badlogic/pi-mono`](https://github.com/badlogic/pi-mono) â€” The agent framework we instrument
- **D3** â€” [`d3js.org`](https://d3js.org/) â€” Visualization engine
- **Fastify** â€” [`fastify.io`](https://fastify.io/) â€” HTTP server
- **Astro** â€” [`astro.build`](https://astro.build/) â€” Web framework

---

**Questions?** Open an issue or check the docs in `/packages/sdk/README.md`.

