/**
 * flamegraph-sdk
 * Token profiler for AI agent sessions.
 */

// Event model and interfaces
export type {
  FlamegraphEvent,
  EventKind,
  SessionSpan,
  TurnSpan,
  ToolExecSpan,
  InstrumentOptions,
  EventCollector,
  TurnEndData,
  LlmCallData,
  ToolExecStartData,
  ToolExecUpdateData,
  ToolExecEndData,
  ContextBuildData,
} from "./event-model.js";

// Collector implementation
export { LocalCollector, estimateTokens } from "./collector.js";

// Instrumentation entry points
export { instrumentAgent, instrumentStream } from "./interceptor.js";
