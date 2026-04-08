import { InstrumentOptions, EventCollector } from "./event-model.js";
import { estimateTokens } from "./collector.js";

// Type stubs for pi-agent (provided by host application)
type Agent = any;
type AgentEvent = any;
type AssistantMessage = any;

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
      collector.recordContextBuild({
        sessionId: agent.sessionId,
        messageCount: result.length,
        estimatedTokens: estimateTokens(result),
        durationMs: Date.now() - before,
        endedAt: Date.now(),
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
