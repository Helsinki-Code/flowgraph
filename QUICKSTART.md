# Token Flame Graph â€” Quick Start

Get up and running in 5 minutes.

## Prerequisites

- Node.js 20+
- npm or pnpm

## Installation

```bash
cd /path/to/token-flamegraph
npm install
```

## Local Development (3 terminals)

### Terminal 1: API Server

```bash
npm run dev --workspace=packages/server
```

Listens on `http://localhost:3000`

### Terminal 2: Web Dashboard

```bash
npm run dev --workspace=packages/web
```

Opens `http://localhost:3000` (Astro dev server)

### Terminal 3: Test the SDK

Create a test file `test-sdk.mjs`:

```javascript
import { LocalCollector } from "./packages/sdk/src/collector.js";

const collector = new LocalCollector();

// Simulate a session
const sessionId = "test-123";
const options = {
  collector,
  workspaceId: "my-workspace",
  feature: "test-feature",
  engineerId: "alice",
};

// Simulate session lifecycle
collector.startSession(sessionId, options);
collector.startTurn(sessionId, 0);

// Simulate LLM call
collector.recordLlmCall({
  sessionId,
  model: "claude-opus",
  provider: "anthropic",
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.0045,
  stopReason: "stop",
  endedAt: Date.now(),
});

// Simulate tool execution
collector.startToolExec({
  sessionId,
  toolCallId: "tool-1",
  toolName: "bash",
  inputBytes: 42,
  startedAt: Date.now(),
});

collector.endToolExec({
  toolCallId: "tool-1",
  outputBytes: 256,
  isError: false,
  endedAt: Date.now(),
});

// Close session
collector.closeSession(sessionId, Date.now());

// Print events
const events = collector.getEvents();
console.log(`Collected ${events.length} events:`);
events.forEach((e) => {
  console.log(`  [${e.kind}] ${e.name || e.toolName || e.model}`);
});

const totalCost = events
  .filter((e) => e.kind === "llm_call")
  .reduce((sum, e) => sum + (e.costUsd || 0), 0);
const totalTokens = events
  .filter((e) => e.kind === "llm_call")
  .reduce((sum, e) => sum + (e.inputTokens || 0) + (e.outputTokens || 0), 0);

console.log(`\nTotal cost: $${totalCost.toFixed(4)}`);
console.log(`Total tokens: ${totalTokens}`);

collector.destroy();
```

Run it:

```bash
node test-sdk.mjs
```

Expected output:

```
Collected 5 events:
  [session] session
  [turn] turn:0
  [llm_call] claude-opus
  [tool_exec] bash
  [context_build] context_build

Total cost: $0.0045
Total tokens: 150
```

## Run Tests

```bash
npm test --workspace=packages/sdk
```

## View the Dashboard

1. Visit `http://localhost:3000` (web dev server)
2. Reload page â€” should show empty sessions table (no data yet)
3. The server is listening on `http://localhost:3000` (API)

## Next Steps

- Read [EXAMPLE.md](./EXAMPLE.md) for real pi-agent integration
- Read [DEPLOYMENT.md](./DEPLOYMENT.md) for production setup
- Check [BUILD_SUMMARY.md](./BUILD_SUMMARY.md) for architecture overview
- Explore the code:
  - SDK: `packages/sdk/src/`
  - Server: `packages/server/src/`
  - Web: `packages/web/src/`

## Troubleshooting

### "Cannot find module" errors

```bash
# Make sure node_modules is installed
npm install

# Clear build cache
rm -rf packages/*/dist
```

### Port 3000 already in use

Change port:

```bash
PORT=3001 npm run dev --workspace=packages/server
```

### Astro dev server won't start

```bash
cd packages/web
npm install
npm run dev
```

### Tests failing

```bash
npm test --workspace=packages/sdk -- --reporter=verbose
```

## Project Structure

```
token-flamegraph/
â”œâ”€â”€ packages/
â”‚   â”œâ”€â”€ sdk/        â† Drop-in instrumentation (npm package)
â”‚   â”œâ”€â”€ storage/    â† SQLite + PostgreSQL adapters
â”‚   â”œâ”€â”€ server/     â† Fastify API
â”‚   â””â”€â”€ web/        â† Astro dashboard
â”œâ”€â”€ README.md
â”œâ”€â”€ EXAMPLE.md      â† How to integrate with pi-agent
â”œâ”€â”€ DEPLOYMENT.md   â† Production setup
â””â”€â”€ BUILD_SUMMARY.md â† Architecture deep-dive
```

## Quick Reference

| Task | Command |
|------|---------|
| Install | `npm install` |
| Dev all | Run 3 terminals: `npm run dev --workspace=packages/{server,web}` + manual SDK test |
| Test | `npm test --workspace=packages/sdk` |
| Format | `npm run format` |
| Lint | `npm run lint` |
| Build | `npm run build` |

## API Cheat Sheet

### Create collector

```typescript
import { LocalCollector } from "flamegraph-sdk";
const collector = new LocalCollector({ autoFlushIntervalMs: 5000 });
```

### Instrument agent

```typescript
import { instrumentAgent } from "flamegraph-sdk";

const unsubscribe = instrumentAgent(agent, {
  collector,
  workspaceId: "workspace-1",
  feature: "my-feature",
  engineerId: "alice",
});

// Later:
unsubscribe();
```

### Get events

```typescript
const events = collector.getEvents();
```

### Calculate totals

```typescript
const totalCost = events
  .filter((e) => e.kind === "llm_call")
  .reduce((sum, e) => sum + (e.costUsd || 0), 0);

const totalTokens = events
  .filter((e) => e.kind === "llm_call")
  .reduce((sum, e) => sum + ((e.inputTokens || 0) + (e.outputTokens || 0)), 0);
```

## Need Help?

- ðŸ“– [README.md](./README.md) â€” Overview
- ðŸš€ [EXAMPLE.md](./EXAMPLE.md) â€” Real integration examples
- ðŸ—ï¸ [BUILD_SUMMARY.md](./BUILD_SUMMARY.md) â€” Architecture & design decisions
- ðŸ“¦ [DEPLOYMENT.md](./DEPLOYMENT.md) â€” How to deploy

---

**Happy profiling! ðŸ”¥**

