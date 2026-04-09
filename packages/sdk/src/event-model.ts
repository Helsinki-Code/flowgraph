/**
 * FlamegraphEvent is the core instrumentation payload.
 */
export type EventKind = "session" | "turn" | "llm_call" | "tool_exec" | "context_build";

export interface FlamegraphEvent {
  // Identity
  eventId: string; // ulid
  sessionId: string; // maps to pi-agent sessionId
  parentId: string | null; // nesting: session -> turn -> llm_call/tool_exec
  workspaceId: string;

  // Attribution
  feature?: string;
  prNumber?: string;
  engineerId?: string;
  projectId?: string;

  // Timing
  startedAt: number; // unix ms
  endedAt?: number;

  // Event type
  kind: EventKind;

  // LLM call data
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";

  // Tool execution data
  toolName?: string;
  toolCallId?: string;
  toolInputBytes?: number;
  toolOutputBytes?: number;
  isError?: boolean;

  // Context build data
  contextMessages?: number;
  contextTokenEstimate?: number;

  // Extensible metadata
  metadata?: Record<string, unknown>;
}

/**
 * In-memory session tree used by collectors.
 */
export interface SessionSpan {
  sessionId: string;
  sessionEventId: string;
  startedAt: number;
  turnStacks: Map<number, TurnSpan>;
  currentTurnIndex?: number;
  currentTurnId?: string;
}

export interface TurnSpan {
  turnIndex: number;
  turnEventId: string;
  startedAt: number;
  toolExecs: Map<string, ToolExecSpan>;
}

export interface ToolExecSpan {
  toolCallId: string;
  toolExecEventId: string;
  toolName: string;
  startedAt: number;
  inputBytes?: number;
}

/**
 * Options passed to instrumentAgent().
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
 * Collector contract for SDK instrumentation.
 */
export interface EventCollector {
  startSession(sessionId: string, options: InstrumentOptions): void;
  startTurn(sessionId: string, turnIndex: number): void;
  endTurn?(data: TurnEndData): void;
  recordLlmCall(data: LlmCallData): void;
  startToolExec(data: ToolExecStartData): void;
  recordToolExecUpdate?(data: ToolExecUpdateData): void;
  endToolExec(data: ToolExecEndData): void;
  recordContextBuild(data: ContextBuildData): void;
  closeSession(sessionId: string, endedAt: number): void;
  flush(): Promise<void>;
}

export interface TurnEndData {
  sessionId: string;
  turnIndex: number;
  endedAt: number;
  metadata?: Record<string, unknown>;
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
  startedAt?: number;
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

export interface ToolExecUpdateData {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  partialResult: unknown;
  at?: number;
}

export interface ToolExecEndData {
  toolCallId: string;
  outputBytes: number;
  isError: boolean;
  endedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ContextBuildData {
  sessionId: string;
  messageCount: number;
  estimatedTokens: number;
  durationMs: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}
