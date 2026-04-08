/**
 * @flamegraph/sdk — Token profiler for AI agent sessions
 * Drop-in instrumentation wrapper for @mariozechner/pi-agent-core
 *
 * Usage:
 *   import { instrumentAgent, LocalCollector } from "@flamegraph/sdk";
 *   import { Agent } from "@mariozechner/pi-agent-core";
 *
 *   const collector = new LocalCollector();
 *   const agent = new Agent(...);
 *   const unsubscribe = instrumentAgent(agent, {
 *     collector,
 *     workspaceId: "my-workspace",
 *     feature: "search",
 *     engineerId: "alice",
 *   });
 *
 *   // Run agent...
 *   await agent.prompt("...");
 *
 *   // Get events for analysis/export
 *   const events = collector.getEvents();
 */
export type { FlamegraphEvent, EventKind, SessionSpan, TurnSpan, ToolExecSpan, InstrumentOptions, EventCollector, LlmCallData, ToolExecStartData, ToolExecEndData, ContextBuildData, } from "./event-model.js";
export { LocalCollector, estimateTokens } from "./collector.js";
export { instrumentAgent, instrumentStream } from "./interceptor.js";
//# sourceMappingURL=index.d.ts.map