import { ulid } from "ulid";
import {
  EventCollector,
  FlamegraphEvent,
  InstrumentOptions,
  SessionSpan,
  TurnSpan,
  ToolExecSpan,
  TurnEndData,
  LlmCallData,
  ToolExecStartData,
  ToolExecUpdateData,
  ToolExecEndData,
  ContextBuildData,
} from "./event-model.js";

/**
 * LocalCollector buffers events in memory and optionally flushes to the server.
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

    this.events.push({
      eventId: turnEventId,
      sessionId,
      parentId: session.sessionEventId,
      workspaceId: this.options?.workspaceId || "",
      kind: "turn",
      startedAt: now,
      metadata: { turnIndex },
    });

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

  endTurn(data: TurnEndData): void {
    const session = this.sessions.get(data.sessionId);
    if (!session) return;

    const turn = session.turnStacks.get(data.turnIndex);
    if (!turn) return;

    const turnEvent = this.events.find((event) => event.eventId === turn.turnEventId);
    if (!turnEvent) return;

    turnEvent.endedAt = data.endedAt;
    turnEvent.metadata = {
      ...(turnEvent.metadata || {}),
      ...(data.metadata || {}),
    };
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
      startedAt: typeof data.startedAt === "number" ? data.startedAt : data.endedAt - 100,
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

    const toolExecSpan: ToolExecSpan = {
      toolCallId: data.toolCallId,
      toolExecEventId,
      toolName: data.toolName,
      startedAt: data.startedAt,
      inputBytes: data.inputBytes,
    };
    turn.toolExecs.set(data.toolCallId, toolExecSpan);
  }

  recordToolExecUpdate(data: ToolExecUpdateData): void {
    const toolEvent = this.events.find(
      (event) => event.toolCallId === data.toolCallId && event.kind === "tool_exec" && !event.endedAt,
    );
    if (!toolEvent) return;

    const metadata = (toolEvent.metadata || {}) as Record<string, unknown>;
    const progress = (metadata.progress || {}) as Record<string, unknown>;
    const updateCount = Number(progress.updateCount || 0) + 1;

    toolEvent.metadata = {
      ...metadata,
      progress: {
        ...progress,
        updateCount,
        lastUpdateAt: data.at || Date.now(),
      },
    };
  }

  endToolExec(data: ToolExecEndData): void {
    const toolEvent = this.events.find(
      (event) => event.toolCallId === data.toolCallId && event.kind === "tool_exec" && !event.endedAt,
    );
    if (!toolEvent) return;

    toolEvent.endedAt = data.endedAt;
    toolEvent.toolOutputBytes = data.outputBytes;
    toolEvent.isError = data.isError;
    if (data.metadata) {
      toolEvent.metadata = {
        ...(toolEvent.metadata || {}),
        ...data.metadata,
      };
    }
  }

  recordContextBuild(data: ContextBuildData): void {
    const session = this.sessions.get(data.sessionId);
    if (!session) return;

    const endedAt = data.endedAt || Date.now();
    this.events.push({
      eventId: ulid(),
      sessionId: data.sessionId,
      parentId: session.currentTurnId || null,
      workspaceId: this.options?.workspaceId || "",
      kind: "context_build",
      startedAt: endedAt - data.durationMs,
      endedAt,
      contextMessages: data.messageCount,
      contextTokenEstimate: data.estimatedTokens,
      metadata: {
        ...(this.options?.agentId ? { agentId: this.options.agentId } : {}),
        ...(data.metadata || {}),
      },
    });
  }

  closeSession(sessionId: string, endedAt: number): void {
    const sessionEvent = this.events.find(
      (event) => event.sessionId === sessionId && event.kind === "session" && !event.endedAt,
    );
    if (sessionEvent) {
      sessionEvent.endedAt = endedAt;
    }

    const session = this.sessions.get(sessionId);
    if (!session) return;

    for (const turnSpan of session.turnStacks.values()) {
      const turnEvent = this.events.find((event) => event.eventId === turnSpan.turnEventId);
      if (turnEvent && !turnEvent.endedAt) {
        turnEvent.endedAt = endedAt;
      }
    }
    this.sessions.delete(sessionId);
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;

    const batch = [...this.events];
    this.events = [];

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
        console.error(`[flamegraph] flush failed: ${response.status} ${response.statusText}`);
        this.events = batch.concat(this.events);
      } else {
        console.log(`[flamegraph] flushed ${batch.length} events to server`);
      }
    } catch (err) {
      console.error("[flamegraph] flush error:", err);
      this.events = batch.concat(this.events);
    }
  }

  getEvents(): FlamegraphEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.sessions.clear();
  }

  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
  }
}

/**
 * Estimate tokens from message content using a simple character heuristic.
 */
export function estimateTokens(messages: any[]): number {
  if (!Array.isArray(messages)) return 0;

  let chars = 0;
  for (const msg of messages) {
    if (typeof msg === "string") {
      chars += msg.length;
      continue;
    }
    if (msg && typeof msg === "object") {
      if ("content" in msg && typeof msg.content === "string") {
        chars += msg.content.length;
      } else {
        chars += JSON.stringify(msg).length;
      }
    }
  }
  return Math.ceil(chars / 4);
}
