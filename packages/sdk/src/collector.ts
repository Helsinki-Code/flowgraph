import { ulid } from "ulid";
import {
  EventCollector,
  FlamegraphEvent,
  InstrumentOptions,
  SessionSpan,
  TurnSpan,
  ToolExecSpan,
  LlmCallData,
  ToolExecStartData,
  ToolExecEndData,
  ContextBuildData,
} from "./event-model.js";

/**
 * LocalCollector — buffers events in memory and batches them
 * Used by SDKs for local development and testing
 * Implements EventCollector interface
 */
export class LocalCollector implements EventCollector {
  private events: FlamegraphEvent[] = [];
  private sessions: Map<string, SessionSpan> = new Map();
  private options: InstrumentOptions | null = null;
  private flushInterval?: ReturnType<typeof setInterval>;
  private serverUrl?: string;
  private apiKey?: string;

  constructor(options?: { autoFlushIntervalMs?: number; serverUrl?: string; apiKey?: string }) {
    this.serverUrl = options?.serverUrl;
    this.apiKey = options?.apiKey;
    if (options?.autoFlushIntervalMs) {
      this.flushInterval = setInterval(() => {
        this.flush().catch((err) => console.error("[flamegraph] flush error:", err));
      }, options.autoFlushIntervalMs);
    }
  }

  startSession(sessionId: string, options: InstrumentOptions): void {
    this.options = options;

    const sessionEventId = ulid();
    const now = Date.now();

    // Create session event
    this.events.push({
      eventId: sessionEventId,
      sessionId,
      parentId: null,
      workspaceId: options.workspaceId,
      kind: "session",
      startedAt: now,
      feature: options.feature,
      metadata: options.agentId ? { agentId: options.agentId } : undefined,
      prNumber: options.prNumber,
      engineerId: options.engineerId,
      projectId: options.projectId,
    });

    // Track session state
    this.sessions.set(sessionId, {
      sessionId,
      sessionEventId,
      startedAt: now,
      turnStacks: new Map(),
    });
  }

  startTurn(sessionId: string, turnIndex: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const turnEventId = ulid();
    const now = Date.now();

    // Create turn event
    this.events.push({
      eventId: turnEventId,
      sessionId,
      parentId: session.sessionEventId,
      workspaceId: this.options?.workspaceId || "",
      kind: "turn",
      startedAt: now,
      metadata: { turnIndex },
    });

    // Track turn state
    const turnSpan: TurnSpan = {
      turnIndex,
      turnEventId,
      startedAt: now,
      toolExecs: new Map(),
    };
    session.turnStacks.set(turnIndex, turnSpan);
    session.currentTurnIndex = turnIndex;
    session.currentTurnId = turnEventId;
  }

  recordLlmCall(data: LlmCallData): void {
    const session = this.sessions.get(data.sessionId);
    if (!session || !session.currentTurnId) return;

    this.events.push({
      eventId: ulid(),
      sessionId: data.sessionId,
      parentId: session.currentTurnId,
      workspaceId: this.options?.workspaceId || "",
      kind: "llm_call",
      startedAt: data.endedAt - 100, // estimate; ideally we'd track from start
      endedAt: data.endedAt,
      model: data.model,
      provider: data.provider,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheReadTokens: data.cacheReadTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      costUsd: data.costUsd,
      stopReason: data.stopReason,
      metadata: {
        ...(this.options?.agentId ? { agentId: this.options.agentId } : {}),
        ...(data.metadata || {}),
      },
    });
  }

  startToolExec(data: ToolExecStartData): void {
    const session = this.sessions.get(data.sessionId);
    if (!session || session.currentTurnIndex === undefined) return;

    const turn = session.turnStacks.get(session.currentTurnIndex);
    if (!turn) return;

    const toolExecEventId = ulid();

    // Create tool exec event
    this.events.push({
      eventId: toolExecEventId,
      sessionId: data.sessionId,
      parentId: session.currentTurnId || null,
      workspaceId: this.options?.workspaceId || "",
      kind: "tool_exec",
      startedAt: data.startedAt,
      toolName: data.toolName,
      toolCallId: data.toolCallId,
      toolInputBytes: data.inputBytes,
      metadata: {
        ...(this.options?.agentId ? { agentId: this.options.agentId } : {}),
        ...(data.metadata || {}),
      },
    });

    // Track tool exec state
    const toolExecSpan: ToolExecSpan = {
      toolCallId: data.toolCallId,
      toolExecEventId,
      toolName: data.toolName,
      startedAt: data.startedAt,
      inputBytes: data.inputBytes,
    };
    turn.toolExecs.set(data.toolCallId, toolExecSpan);
  }

  endToolExec(data: ToolExecEndData): void {
    // Find the tool exec event and update it
    const toolEvent = this.events.find(
      (e) => e.toolCallId === data.toolCallId && e.kind === "tool_exec" && !e.endedAt,
    );
    if (toolEvent) {
      toolEvent.endedAt = data.endedAt;
      toolEvent.toolOutputBytes = data.outputBytes;
      toolEvent.isError = data.isError;
    }
  }

  recordContextBuild(data: ContextBuildData): void {
    const session = this.sessions.get(data.sessionId);
    if (!session) return;

    this.events.push({
      eventId: ulid(),
      sessionId: data.sessionId,
      parentId: session.currentTurnId || null,
      workspaceId: this.options?.workspaceId || "",
      kind: "context_build",
      startedAt: (data.endedAt || Date.now()) - data.durationMs,
      endedAt: data.endedAt,
      contextMessages: data.messageCount,
      contextTokenEstimate: data.estimatedTokens,
      metadata: {
        ...(this.options?.agentId ? { agentId: this.options.agentId } : {}),
        ...(data.metadata || {}),
      },
    });
  }

  closeSession(sessionId: string, endedAt: number): void {
    // Update the session event with end time
    const sessionEvent = this.events.find(
      (e) => e.sessionId === sessionId && e.kind === "session" && !e.endedAt,
    );
    if (sessionEvent) {
      sessionEvent.endedAt = endedAt;
    }

    // Update all turn events with end time
    const session = this.sessions.get(sessionId);
    if (session) {
      for (const turnSpan of session.turnStacks.values()) {
        const turnEvent = this.events.find((e) => e.eventId === turnSpan.turnEventId);
        if (turnEvent && !turnEvent.endedAt) {
          turnEvent.endedAt = endedAt;
        }
      }
    }
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;

    const batch = [...this.events];
    this.events = [];

    // Skip if no server configured (local mode)
    if (!this.serverUrl) {
      console.log(`[flamegraph] local mode: ${batch.length} events buffered (no server configured)`);
      return;
    }

    try {
      const response = await fetch(`${this.serverUrl}/v1/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": ulid(),
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        console.error(
          `[flamegraph] flush failed: ${response.status} ${response.statusText}`,
        );
        // Re-add events to buffer on failure
        this.events = batch.concat(this.events);
      } else {
        console.log(`[flamegraph] flushed ${batch.length} events to server`);
      }
    } catch (err) {
      console.error(`[flamegraph] flush error:`, err);
      // Re-add events to buffer on error
      this.events = batch.concat(this.events);
    }
  }

  /**
   * Get all events collected so far
   * Useful for testing
   */
  getEvents(): FlamegraphEvent[] {
    return [...this.events];
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
    this.sessions.clear();
  }

  /**
   * Cleanup (stop auto-flush interval if running)
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
  }
}

/**
 * Utility: estimate tokens from message array using character count heuristic
 * ~4 chars per token (rough average)
 */
export function estimateTokens(messages: any[]): number {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg === "string") {
      chars += msg.length;
    } else if (msg && typeof msg === "object") {
      if ("content" in msg && typeof msg.content === "string") {
        chars += msg.content.length;
      } else {
        chars += JSON.stringify(msg).length;
      }
    }
  }
  return Math.ceil(chars / 4);
}
