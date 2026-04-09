import { InstrumentOptions, EventCollector } from "./event-model.js";
import { estimateTokens } from "./collector.js";

// Type stubs for pi-agent (provided by host application).
type Agent = any;
type AgentEvent = any;
type AssistantMessage = any;

type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

interface StreamingStats {
  updateCount: number;
  firstUpdateAt?: number;
  lastUpdateAt?: number;
  textDeltaChars: number;
  thinkingDeltaChars: number;
  toolCallDeltaChars: number;
  eventTypeCounts: Record<string, number>;
}

interface ToolUpdateStats {
  updateCount: number;
  firstUpdateAt?: number;
  lastUpdateAt?: number;
  partialBytes: number;
}

function stableString(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input ?? "");
  }
}

function tinyHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function safeByteLength(input: unknown): number {
  const encoded = stableString(input);
  return Buffer.byteLength(encoded, "utf8");
}

function safeNumber(input: unknown): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
}

function asStopReason(input: unknown): StopReason {
  if (input === "stop" || input === "length" || input === "toolUse" || input === "error" || input === "aborted") {
    return input;
  }
  return "stop";
}

function extractContextAnatomyFromMessage(msg: AssistantMessage): Record<string, unknown> | undefined {
  const usage = msg?.usage;
  if (!usage) return undefined;

  const candidates = [
    msg?.contextAnatomy,
    msg?.context_anatomy,
    msg?.metadata?.contextAnatomy,
    msg?.metadata?.context_anatomy,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }

  const input = safeNumber(usage.input);
  if (input <= 0) return undefined;
  return {
    systemPromptTokens: Math.round(input * 0.14),
    historyTokens: Math.round(input * 0.46),
    toolResultTokens: Math.round(input * 0.22),
    currentTurnTokens: Math.max(
      0,
      input - Math.round(input * 0.14) - Math.round(input * 0.46) - Math.round(input * 0.22),
    ),
  };
}

function getAssistantMessageKey(msg: AssistantMessage): string | undefined {
  if (!msg || msg.role !== "assistant") return undefined;

  const responseId = typeof msg.responseId === "string" ? msg.responseId : undefined;
  if (responseId && responseId.trim() !== "") {
    return `response:${responseId}`;
  }

  const timestamp = safeNumber(msg.timestamp);
  const model = typeof msg.model === "string" ? msg.model : "unknown";
  const provider = typeof msg.provider === "string" ? msg.provider : "unknown";
  const contentShape = Array.isArray(msg.content)
    ? msg.content
        .map((part: any) => `${String(part?.type || "unknown")}:${String(part?.name || "")}`)
        .join("|")
    : "none";
  if (timestamp > 0) {
    return `ts:${timestamp}:${provider}:${model}:${tinyHash(contentShape)}`;
  }
  return undefined;
}

function summarizeAssistantContent(msg: AssistantMessage): Record<string, number> {
  const content = Array.isArray(msg?.content) ? msg.content : [];
  let textChars = 0;
  let thinkingChars = 0;
  let toolCalls = 0;

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text") textChars += String(item.text || "").length;
    if (item.type === "thinking") thinkingChars += String(item.thinking || "").length;
    if (item.type === "toolCall") toolCalls += 1;
  }

  return { contentBlocks: content.length, textChars, thinkingChars, toolCalls };
}

function updateStreamingStats(stats: StreamingStats, assistantMessageEvent: any, at: number): void {
  const type = String(assistantMessageEvent?.type || "unknown");
  stats.updateCount += 1;
  stats.firstUpdateAt = stats.firstUpdateAt ?? at;
  stats.lastUpdateAt = at;
  stats.eventTypeCounts[type] = (stats.eventTypeCounts[type] || 0) + 1;

  if (type === "text_delta") stats.textDeltaChars += String(assistantMessageEvent?.delta || "").length;
  if (type === "thinking_delta") stats.thinkingDeltaChars += String(assistantMessageEvent?.delta || "").length;
  if (type === "toolcall_delta") stats.toolCallDeltaChars += String(assistantMessageEvent?.delta || "").length;
}

/**
 * instrumentAgent() wraps a pi-agent Agent with instrumentation hooks.
 */
export function instrumentAgent(agent: Agent, options: InstrumentOptions): () => void {
  const collector = options.collector;

  let currentTurnIndex = 0;
  let sessionStarted = false;

  const llmStartByMessageKey = new Map<string, number>();
  const streamStatsByMessageKey = new Map<string, StreamingStats>();
  const toolStatsByCallId = new Map<string, ToolUpdateStats>();

  const unsub = agent.subscribe(async (event: AgentEvent) => {
    const now = Date.now();

    try {
      if (event.type === "agent_start") {
        sessionStarted = true;
        currentTurnIndex = 0;
        llmStartByMessageKey.clear();
        streamStatsByMessageKey.clear();
        toolStatsByCallId.clear();
        if (agent.sessionId) {
          collector.startSession(agent.sessionId, options);
        }
      }

      if (event.type === "turn_start" && agent.sessionId) {
        collector.startTurn(agent.sessionId, currentTurnIndex);
      }

      if (event.type === "message_start") {
        const msg = event.message as AssistantMessage;
        if (msg?.role === "assistant") {
          const messageKey = getAssistantMessageKey(msg);
          if (messageKey) {
            llmStartByMessageKey.set(messageKey, now);
            if (!streamStatsByMessageKey.has(messageKey)) {
              streamStatsByMessageKey.set(messageKey, {
                updateCount: 0,
                textDeltaChars: 0,
                thinkingDeltaChars: 0,
                toolCallDeltaChars: 0,
                eventTypeCounts: {},
              });
            }
          }
        }
      }

      if (event.type === "message_update") {
        const msg = event.message as AssistantMessage;
        if (msg?.role === "assistant") {
          const messageKey = getAssistantMessageKey(msg);
          if (messageKey) {
            const stats =
              streamStatsByMessageKey.get(messageKey) ||
              ({
                updateCount: 0,
                textDeltaChars: 0,
                thinkingDeltaChars: 0,
                toolCallDeltaChars: 0,
                eventTypeCounts: {},
              } as StreamingStats);
            updateStreamingStats(stats, event.assistantMessageEvent, now);
            streamStatsByMessageKey.set(messageKey, stats);
          }
        }
      }

      if (event.type === "message_end") {
        const msg = event.message as AssistantMessage;
        if (msg?.role === "assistant" && agent.sessionId) {
          const usage = msg.usage || {};
          const messageKey = getAssistantMessageKey(msg);
          const startedAt = messageKey ? llmStartByMessageKey.get(messageKey) : undefined;
          const streamStats = messageKey ? streamStatsByMessageKey.get(messageKey) : undefined;

          const promptMaterial = stableString(
            msg?.request || msg?.prompt || msg?.messages || msg?.input || msg?.metadata?.prompt || "",
          );
          const promptSignature =
            promptMaterial && promptMaterial !== "null" && promptMaterial !== '""'
              ? tinyHash(promptMaterial)
              : undefined;
          const contextAnatomy = extractContextAnatomyFromMessage(msg);
          const contentSummary = summarizeAssistantContent(msg);

          collector.recordLlmCall({
            sessionId: agent.sessionId,
            model: typeof msg.model === "string" && msg.model ? msg.model : "unknown",
            provider: typeof msg.provider === "string" && msg.provider ? msg.provider : "unknown",
            inputTokens: safeNumber(usage.input),
            outputTokens: safeNumber(usage.output),
            cacheReadTokens: safeNumber(usage.cacheRead),
            cacheWriteTokens: safeNumber(usage.cacheWrite),
            costUsd: safeNumber(usage?.cost?.total),
            stopReason: asStopReason(msg.stopReason),
            startedAt,
            endedAt: now,
            metadata: {
              ...(options.agentId ? { agentId: options.agentId } : {}),
              ...(promptSignature ? { promptSignature } : {}),
              ...(contextAnatomy ? { contextAnatomy } : {}),
              contentSummary,
              stream:
                streamStats && streamStats.updateCount > 0
                  ? {
                      updateCount: streamStats.updateCount,
                      firstUpdateOffsetMs:
                        typeof startedAt === "number" && typeof streamStats.firstUpdateAt === "number"
                          ? Math.max(0, streamStats.firstUpdateAt - startedAt)
                          : undefined,
                      streamDurationMs:
                        typeof streamStats.firstUpdateAt === "number" &&
                        typeof streamStats.lastUpdateAt === "number"
                          ? Math.max(0, streamStats.lastUpdateAt - streamStats.firstUpdateAt)
                          : undefined,
                      eventTypeCounts: streamStats.eventTypeCounts,
                      textDeltaChars: streamStats.textDeltaChars,
                      thinkingDeltaChars: streamStats.thinkingDeltaChars,
                      toolCallDeltaChars: streamStats.toolCallDeltaChars,
                    }
                  : undefined,
            },
          });

          if (messageKey) {
            llmStartByMessageKey.delete(messageKey);
            streamStatsByMessageKey.delete(messageKey);
          }
        }
      }

      if (event.type === "tool_execution_start" && agent.sessionId && event.toolCallId && event.toolName) {
        collector.startToolExec({
          sessionId: agent.sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          inputBytes: safeByteLength(event.args),
          startedAt: now,
          metadata: {
            ...(options.agentId ? { agentId: options.agentId } : {}),
          },
        });

        toolStatsByCallId.set(event.toolCallId, {
          updateCount: 0,
          partialBytes: 0,
        });
      }

      if (event.type === "tool_execution_update" && agent.sessionId && event.toolCallId && event.toolName) {
        const stats = toolStatsByCallId.get(event.toolCallId) || {
          updateCount: 0,
          partialBytes: 0,
        };
        stats.updateCount += 1;
        stats.partialBytes += safeByteLength(event.partialResult);
        stats.firstUpdateAt = stats.firstUpdateAt ?? now;
        stats.lastUpdateAt = now;
        toolStatsByCallId.set(event.toolCallId, stats);

        collector.recordToolExecUpdate?.({
          sessionId: agent.sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          partialResult: event.partialResult,
          at: now,
        });
      }

      if (event.type === "tool_execution_end" && event.toolCallId) {
        const stats = toolStatsByCallId.get(event.toolCallId);
        collector.endToolExec({
          toolCallId: event.toolCallId,
          outputBytes: safeByteLength(event.result),
          isError: Boolean(event.isError),
          endedAt: now,
          metadata: stats
            ? {
                progress: {
                  updateCount: stats.updateCount,
                  partialBytes: stats.partialBytes,
                  firstUpdateAt: stats.firstUpdateAt,
                  lastUpdateAt: stats.lastUpdateAt,
                  updateDurationMs:
                    typeof stats.firstUpdateAt === "number" && typeof stats.lastUpdateAt === "number"
                      ? Math.max(0, stats.lastUpdateAt - stats.firstUpdateAt)
                      : 0,
                },
              }
            : undefined,
        });
        toolStatsByCallId.delete(event.toolCallId);
      }

      if (event.type === "turn_end" && agent.sessionId) {
        const assistantMessage = event.message;
        const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
        collector.endTurn?.({
          sessionId: agent.sessionId,
          turnIndex: currentTurnIndex,
          endedAt: now,
          metadata: {
            turnIndex: currentTurnIndex,
            toolResultCount: toolResults.length,
            toolErrors: toolResults.filter((result: any) => Boolean(result?.isError)).length,
            messageRole: assistantMessage?.role,
            stopReason: assistantMessage?.stopReason,
            turnOutputTokens: safeNumber(assistantMessage?.usage?.output),
          },
        });
        currentTurnIndex++;
      }

      if (event.type === "agent_end") {
        if (agent.sessionId) {
          collector.closeSession(agent.sessionId, now);
        }
        await collector.flush();
        sessionStarted = false;
        llmStartByMessageKey.clear();
        streamStatsByMessageKey.clear();
        toolStatsByCallId.clear();
      }
    } catch (err) {
      console.error("[flamegraph] instrumentation error:", err);
    }
  });

  // Wrap transformContext to measure context-building cost.
  const originalTransform = agent.transformContext;
  agent.transformContext = async (messages: any[], signal?: AbortSignal) => {
    const before = Date.now();
    const transformed = originalTransform ? await originalTransform(messages, signal) : messages;
    const normalizedMessages = Array.isArray(transformed) ? transformed : messages;

    if (agent.sessionId && sessionStarted) {
      const roleCounts = Array.isArray(normalizedMessages)
        ? normalizedMessages.reduce(
            (acc: Record<string, number>, item: any) => {
              const role = typeof item?.role === "string" ? item.role : "unknown";
              acc[role] = (acc[role] || 0) + 1;
              return acc;
            },
            {},
          )
        : {};

      collector.recordContextBuild({
        sessionId: agent.sessionId,
        messageCount: Array.isArray(normalizedMessages) ? normalizedMessages.length : 0,
        estimatedTokens: estimateTokens(Array.isArray(normalizedMessages) ? normalizedMessages : []),
        durationMs: Date.now() - before,
        endedAt: Date.now(),
        metadata: {
          ...(options.agentId ? { agentId: options.agentId } : {}),
          roleCounts,
        },
      });
    }

    return transformed;
  };

  return () => {
    unsub();
    agent.transformContext = originalTransform;
  };
}

/**
 * instrumentStream() wraps a raw stream function for non-Agent use.
 */
export function instrumentStream<TApi, TOptions>(
  streamFn: (model: any, context: any, options?: TOptions) => any,
  _collector: EventCollector,
  _workspaceId: string,
): typeof streamFn {
  return (model: any, context: any, options?: TOptions) => {
    const stream = streamFn(model, context, options);
    const wrappedStream = {
      async *[Symbol.asyncIterator]() {
        for await (const event of stream) {
          yield event;
        }
      },
    };
    return wrappedStream;
  };
}
