/**
 * FlamegraphEvent — the core data model for all instrumentation
 * Every token-generating action maps to one or more of these events
 */

export type EventKind = "session" | "turn" | "llm_call" | "tool_exec" | "context_build";

export interface FlamegraphEvent {
  // Identity
  eventId: string; // ulid
  sessionId: string; // maps to pi-agent sessionId
  parentId: string | null; // for nesting: session → turn → llm_call + tool_exec
  workspaceId: string; // multi-tenant

  // Attribution (set by user via instrumentAgent options)
  feature?: string; // "search-bar", "auth-flow"
  prNumber?: string; // "234"
  engineerId?: string; // "alice"
  projectId?: string;

  // Timing
  startedAt: number; // Unix ms
  endedAt?: number;

  // Event type
  kind: EventKind;

  // LLM call data (kind === "llm_call")
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";

  // Tool exec data (kind === "tool_exec")
  toolName?: string;
  toolCallId?: string;
  toolInputBytes?: number;
  toolOutputBytes?: number;
  isError?: boolean;

  // Context build data (kind === "context_build")
  contextMessages?: number;
  contextTokenEstimate?: number;

  // Raw metadata
  metadata?: Record<string, unknown>;
}

/**
 * Session state tracker — in-memory representation of a session's event tree
 * Used by Collector to build parent-child relationships
 */
export interface SessionSpan {
  sessionId: string;
  sessionEventId: string;
  startedAt: number;
  turnStacks: Map<number, TurnSpan>; // turnIndex → TurnSpan
  currentTurnIndex?: number;
  currentTurnId?: string;
}

export interface TurnSpan {
  turnIndex: number;
  turnEventId: string;
  startedAt: number;
  toolExecs: Map<string, ToolExecSpan>; // toolCallId → ToolExecSpan
}

export interface ToolExecSpan {
  toolCallId: string;
  toolExecEventId: string;
  toolName: string;
  startedAt: number;
  inputBytes?: number;
}

/**
 * Instrumentation options passed to instrumentAgent()
 */
export interface InstrumentOptions {
  collector: EventCollector;
  workspaceId: string;
  agentId?: string;
  feature?: string;
  prNumber?: string;
  engineerId?: string;
  projectId?: string;
}

/**
 * EventCollector interface — where events go (local storage, remote API, etc.)
 */
export interface EventCollector {
  startSession(sessionId: string, options: InstrumentOptions): void;
  startTurn(sessionId: string, turnIndex: number): void;
  recordLlmCall(data: LlmCallData): void;
  startToolExec(data: ToolExecStartData): void;
  endToolExec(data: ToolExecEndData): void;
  recordContextBuild(data: ContextBuildData): void;
  closeSession(sessionId: string, endedAt: number): void;
  flush(): Promise<void>;
}

export interface LlmCallData {
  sessionId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  endedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ToolExecStartData {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  inputBytes: number;
  startedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ToolExecEndData {
  toolCallId: string;
  outputBytes: number;
  isError: boolean;
  endedAt: number;
}

export interface ContextBuildData {
  sessionId: string;
  messageCount: number;
  estimatedTokens: number;
  durationMs: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}
