/**
 * FlamegraphEvent — the core data model for all instrumentation
 * Every token-generating action maps to one or more of these events
 */
export type EventKind = "session" | "turn" | "llm_call" | "tool_exec" | "context_build";
export interface FlamegraphEvent {
    eventId: string;
    sessionId: string;
    parentId: string | null;
    workspaceId: string;
    feature?: string;
    prNumber?: string;
    engineerId?: string;
    projectId?: string;
    startedAt: number;
    endedAt?: number;
    kind: EventKind;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    costUsd?: number;
    stopReason?: "stop" | "length" | "toolUse" | "error" | "aborted";
    toolName?: string;
    toolCallId?: string;
    toolInputBytes?: number;
    toolOutputBytes?: number;
    isError?: boolean;
    contextMessages?: number;
    contextTokenEstimate?: number;
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
 * Instrumentation options passed to instrumentAgent()
 */
export interface InstrumentOptions {
    collector: EventCollector;
    workspaceId: string;
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
    stopReason: string;
    endedAt: number;
}
export interface ToolExecStartData {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    inputBytes: number;
    startedAt: number;
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
}
//# sourceMappingURL=event-model.d.ts.map