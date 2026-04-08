# Token Flame Graph — Integration Example

Here's how to use the SDK with a real pi-agent setup.

## Setup

```bash
npm install @flamegraph/sdk @mariozechner/pi-agent-core @mariozechner/pi-ai
```

## Basic Example

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { instrumentAgent, LocalCollector } from "@flamegraph/sdk";

// 1. Create the collector (local SQLite for development)
const collector = new LocalCollector({
  autoFlushIntervalMs: 5000,
});

// 2. Create your agent as usual
const agent = new Agent({
  initialState: {
    model: getModel("claude", "opus"),
  },
});

// 3. Instrument the agent
const unsubscribe = instrumentAgent(agent, {
  collector,
  workspaceId: "my-workspace",
  feature: "code-search",
  engineerId: "alice",
  prNumber: "456",
});

// 4. Run the agent
await agent.prompt("Find all users in the database and create a report");
await agent.continue();

// 5. Get the events for analysis
const events = collector.getEvents();
console.log(`Collected ${events.length} events`);

// 6. Calculate totals
const totalCost = events
  .filter((e) => e.kind === "llm_call")
  .reduce((sum, e) => sum + (e.costUsd || 0), 0);

const totalTokens = events
  .filter((e) => e.kind === "llm_call")
  .reduce((sum, e) => sum + (e.inputTokens || 0) + (e.outputTokens || 0), 0);

console.log(`Total cost: $${totalCost.toFixed(4)}`);
console.log(`Total tokens: ${totalTokens}`);

// 7. Save events to file (optional)
import fs from "fs";
fs.writeFileSync("session.json", JSON.stringify(events, null, 2));

// 8. Cleanup
unsubscribe();
collector.destroy();
```

## Server Integration

If you're running the full stack locally:

1. Start the server:
   ```bash
   npm run dev --workspace=packages/server
   ```

2. Modify the collector to POST events to the server:
   ```typescript
   class RemoteCollector implements EventCollector {
     async flush(): Promise<void> {
       const events = this.buffer; // your buffered events
       const response = await fetch("http://localhost:3000/v1/events", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(events),
       });
       if (!response.ok) throw new Error("Ingest failed");
     }
   }
   ```

3. Visit `http://localhost:3001` to see the dashboard.

## Cost Attribution

The SDK captures attribution data automatically:

```typescript
instrumentAgent(agent, {
  collector,
  workspaceId: "acme-corp",
  feature: "customer-support",  // ← shows in dashboards
  engineerId: "bob",             // ← cost breakdown by engineer
  prNumber: "789",               // ← cost by PR
  projectId: "project-search",   // ← cost by project
});
```

Then view:
- **Cost breakdown by engineer** → See which team members burn the most budget
- **Cost by feature** → Which features are expensive?
- **Cost by PR** → Did this change increase token usage?

## Loop Detection

The SDK automatically detects when the same tool is called 3+ times in a row:

```
⚠️ Loop detected: bash called 5 times in turn 3
  - bash (input: 84 bytes, output: 2048 bytes, error: false)
  - bash (input: 84 bytes, output: 2048 bytes, error: false)
  - bash (input: 84 bytes, output: 2048 bytes, error: false)
  - bash (input: 84 bytes, output: 2048 bytes, error: false)
  - bash (input: 84 bytes, output: 2048 bytes, error: false)
```

This indicates the agent is stuck in a loop. You can:
1. Add logic to break the loop
2. Set max turns / max tool calls
3. Use the flame graph dashboard to identify which tool is looping

## Custom Metadata

Attach custom metadata to events:

```typescript
// This isn't directly supported yet, but you can extend EventCollector:
class CustomCollector extends LocalCollector {
  recordCustom(data: Record<string, unknown>) {
    this.events.push({
      eventId: ulid(),
      sessionId: this.currentSessionId,
      parentId: null,
      workspaceId: this.workspaceId,
      kind: "custom" as any,
      startedAt: Date.now(),
      metadata: data,
    });
  }
}
```

## Performance Considerations

The SDK is **zero-copy** and **non-blocking**:
- Event subscription is async but non-blocking
- Collector buffers in memory (cleared on flush)
- No GC pause from JSON serialization until flush
- ~1MB per 10K events (rough estimate)

For long-running agents, flush periodically:
```typescript
const collector = new LocalCollector({
  autoFlushIntervalMs: 10_000, // Flush every 10 seconds
});
```

## Troubleshooting

### Events are empty
- Make sure you `await` the agent operations: `await agent.prompt(...)`
- Check that the agent actually ran (made tool calls, etc.)
- Subscribe to `agent.subscribe()` directly to debug:
  ```typescript
  agent.subscribe((event) => console.log(event.type));
  ```

### No LLM calls recorded
- Verify the model is set correctly
- Check that you're using a valid LLM provider (Anthropic, OpenAI, etc.)
- Look for errors in agent state: `console.log(agent.state)`

### High memory usage
- Call `collector.flush()` more frequently
- Implement a custom `EventCollector` that writes to disk immediately
- Use the server's `POST /v1/events` endpoint to offload to server

## Next Steps

- [Read the API docs](./packages/sdk/README.md)
- [Deploy the dashboard](./packages/web/README.md)
- [Set up Stripe billing](./packages/server/README.md)
