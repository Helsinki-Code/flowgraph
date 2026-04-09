import { InstrumentOptions, EventCollector } from "./event-model.js";
import { estimateTokens } from "./collector.js";

// Type stubs for pi-agent (provided by host application)
type Agent = any;
type AgentEvent = any;
type AssistantMessage = any;

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

  // Fallback heuristic based on prompt usage tokens
  const input = Number(usage.input || 0);
  if (!Number.isFinite(input) || input <= 0) return undefined;
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

/**
 * instrumentAgent() — main entry point
 * Wraps a pi-agent Agent with flamegraph instrumentation
 * Returns unsubscribe function
 */
export function instrumentAgent(agent: Agent, options: InstrumentOptions): () => void {
  const collector = options.collector;

  // Track turn index (we need to infer it from message count or track it ourselves)
  let currentTurnIndex = 0;
  let sessionStarted = false;

  // Subscribe to all AgentEvents
  const unsub = agent.subscribe(async (event: AgentEvent, signal?: AbortSignal) => {
    const now = Date.now();

    try {
      if (event.type === "agent_start") {
        sessionStarted = true;
        currentTurnIndex = 0;
        if (agent.sessionId) {
          collector.startSession(agent.sessionId, options);
        }
      }

      if (event.type === "turn_start") {
        if (agent.sessionId) {
          collector.startTurn(agent.sessionId, currentTurnIndex);
        }
      }

      if (event.type === "message_end") {
        const msg = event.message as AssistantMessage;
        const promptMaterial = stableString(
          msg?.request || msg?.prompt || msg?.messages || msg?.input || msg?.metadata?.prompt,
        );
        const contextAnatomy = extractContextAnatomyFromMessage(msg);

        // Record LLM call with full usage data
        if (msg.usage && agent.sessionId && msg.model && msg.provider) {
          collector.recordLlmCall({
            sessionId: agent.sessionId,
            model: msg.model,
            provider: msg.provider,
            inputTokens: msg.usage.input,
            outputTokens: msg.usage.output,
            cacheReadTokens: msg.usage.cacheRead,
            cacheWriteTokens: msg.usage.cacheWrite,
            costUsd: msg.usage.cost.total,
            stopReason: (msg.stopReason || "stop") as "stop" | "length" | "toolUse" | "error" | "aborted",
            endedAt: now,
            metadata: {
              ...(options.agentId ? { agentId: options.agentId } : {}),
              promptSignature: tinyHash(promptMaterial),
              ...(contextAnatomy ? { contextAnatomy } : {}),
            },
          });
        }
      }

      if (event.type === "tool_execution_start") {
        // Record tool execution start
        if (agent.sessionId && event.toolCallId && event.toolName) {
          collector.startToolExec({
            sessionId: agent.sessionId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            inputBytes: JSON.stringify(event.args).length,
            startedAt: now,
            metadata: {
              ...(options.agentId ? { agentId: options.agentId } : {}),
            },
          });
        }
      }

      if (event.type === "tool_execution_end") {
        // Record tool execution end
        if (event.toolCallId) {
          collector.endToolExec({
            toolCallId: event.toolCallId,
            outputBytes: JSON.stringify(event.result).length,
            isError: event.isError || false,
            endedAt: now,
          });
        }
      }

      if (event.type === "turn_end") {
        currentTurnIndex++;
      }

      if (event.type === "agent_end") {
        if (agent.sessionId) {
          collector.closeSession(agent.sessionId, now);
        }
        await collector.flush();
        sessionStarted = false;
      }
    } catch (err) {
      console.error("[flamegraph] instrumentation error:", err);
    }
  });

  // Wrap transformContext to measure context window build cost
  const originalTransform = agent.transformContext;
  agent.transformContext = async (messages: any[], signal?: AbortSignal) => {
    const before = Date.now();
    const result = originalTransform
      ? await originalTransform(messages, signal)
      : messages;

    if (agent.sessionId && sessionStarted) {
      const roleCounts = Array.isArray(result)
        ? result.reduce(
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
        messageCount: result.length,
        estimatedTokens: estimateTokens(result),
        durationMs: Date.now() - before,
        endedAt: Date.now(),
        metadata: {
          ...(options.agentId ? { agentId: options.agentId } : {}),
          roleCounts,
        },
      });
    }

    return result;
  };

  // Return unsubscribe function
  return () => {
    unsub();
    if (originalTransform) {
      agent.transformContext = originalTransform;
    }
  };
}

/**
 * instrumentStream() — wraps a raw stream function for non-Agent use
 * Useful for instrumenting direct calls to stream() or completeSimple()
 */
export function instrumentStream<TApi, TOptions>(
  streamFn: (model: any, context: any, options?: TOptions) => any,
  collector: EventCollector,
  workspaceId: string,
): typeof streamFn {
  return (model: any, context: any, options?: TOptions) => {
    const stream = streamFn(model, context, options);
    const startTime = Date.now();
    let tokenCount = 0;

    // Wrap the stream to collect token data
    const wrappedStream = {
      async *[Symbol.asyncIterator]() {
        for await (const event of stream) {
          // Pass through event
          yield event;

          // Intercept done event to record cost
          if (event.type === "done" && event.message) {
            const msg = event.message as AssistantMessage;
            if (msg.usage) {
              tokenCount = msg.usage.totalTokens;
              // Note: would record here with session ID if available
            }
          }
        }
      },
    };

    return wrappedStream;
  };
}
