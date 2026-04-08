import { estimateTokens } from "./collector.js";
/**
 * instrumentAgent() — main entry point
 * Wraps a pi-agent Agent with flamegraph instrumentation
 * Returns unsubscribe function
 */
export function instrumentAgent(agent, options) {
    const collector = options.collector;
    // Track turn index (we need to infer it from message count or track it ourselves)
    let currentTurnIndex = 0;
    let sessionStarted = false;
    // Subscribe to all AgentEvents
    const unsub = agent.subscribe(async (event, signal) => {
        const now = Date.now();
        try {
            if (event.type === "agent_start") {
                sessionStarted = true;
                currentTurnIndex = 0;
                collector.startSession(agent.sessionId, options);
            }
            if (event.type === "turn_start") {
                collector.startTurn(agent.sessionId, currentTurnIndex);
            }
            if (event.type === "message_end") {
                const msg = event.message;
                // Record LLM call with full usage data
                if (msg.usage) {
                    collector.recordLlmCall({
                        sessionId: agent.sessionId,
                        model: msg.model,
                        provider: msg.provider,
                        inputTokens: msg.usage.input,
                        outputTokens: msg.usage.output,
                        cacheReadTokens: msg.usage.cacheRead,
                        cacheWriteTokens: msg.usage.cacheWrite,
                        costUsd: msg.usage.cost.total,
                        stopReason: msg.stopReason,
                        endedAt: now,
                    });
                }
            }
            if (event.type === "tool_execution_start") {
                // Record tool execution start
                collector.startToolExec({
                    sessionId: agent.sessionId,
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    inputBytes: JSON.stringify(event.args).length,
                    startedAt: now,
                });
            }
            if (event.type === "tool_execution_end") {
                // Record tool execution end
                collector.endToolExec({
                    toolCallId: event.toolCallId,
                    outputBytes: JSON.stringify(event.result).length,
                    isError: event.isError,
                    endedAt: now,
                });
            }
            if (event.type === "turn_end") {
                currentTurnIndex++;
            }
            if (event.type === "agent_end") {
                collector.closeSession(agent.sessionId, now);
                await collector.flush();
                sessionStarted = false;
            }
        }
        catch (err) {
            console.error("[flamegraph] instrumentation error:", err);
        }
    });
    // Wrap transformContext to measure context window build cost
    const originalTransform = agent.transformContext;
    agent.transformContext = async (messages, signal) => {
        const before = Date.now();
        const result = originalTransform
            ? await originalTransform(messages, signal)
            : messages;
        collector.recordContextBuild({
            sessionId: agent.sessionId,
            messageCount: result.length,
            estimatedTokens: estimateTokens(result),
            durationMs: Date.now() - before,
            endedAt: Date.now(),
        });
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
export function instrumentStream(streamFn, collector, workspaceId) {
    return (model, context, options) => {
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
                        const msg = event.message;
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
//# sourceMappingURL=interceptor.js.map