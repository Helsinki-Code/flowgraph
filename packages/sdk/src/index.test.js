import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LocalCollector, estimateTokens } from "./collector.js";
describe("LocalCollector", () => {
    let collector;
    beforeEach(() => {
        collector = new LocalCollector();
    });
    afterEach(() => {
        collector.destroy();
    });
    it("should initialize with empty events", () => {
        const events = collector.getEvents();
        expect(events).toHaveLength(0);
    });
    it("should record a full session lifecycle", async () => {
        const sessionId = "test-session-123";
        const options = {
            collector,
            workspaceId: "workspace-1",
            feature: "test-feature",
            engineerId: "test-engineer",
        };
        // Start session
        collector.startSession(sessionId, options);
        let events = collector.getEvents();
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe("session");
        // Start turn
        collector.startTurn(sessionId, 0);
        events = collector.getEvents();
        expect(events).toHaveLength(2);
        expect(events[1].kind).toBe("turn");
        // Record LLM call
        collector.recordLlmCall({
            sessionId,
            model: "claude-opus",
            provider: "anthropic",
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0.0045,
            stopReason: "stop",
            endedAt: Date.now(),
        });
        events = collector.getEvents();
        expect(events).toHaveLength(3);
        expect(events[2].kind).toBe("llm_call");
        expect(events[2].inputTokens).toBe(100);
        expect(events[2].outputTokens).toBe(50);
        expect(events[2].costUsd).toBe(0.0045);
        // Start tool execution
        collector.startToolExec({
            sessionId,
            toolCallId: "tool-1",
            toolName: "bash",
            inputBytes: 42,
            startedAt: Date.now(),
        });
        events = collector.getEvents();
        expect(events).toHaveLength(4);
        expect(events[3].kind).toBe("tool_exec");
        // End tool execution
        collector.endToolExec({
            toolCallId: "tool-1",
            outputBytes: 256,
            isError: false,
            endedAt: Date.now(),
        });
        events = collector.getEvents();
        expect(events[3].toolOutputBytes).toBe(256);
        expect(events[3].isError).toBe(false);
        // Record context build
        collector.recordContextBuild({
            sessionId,
            messageCount: 5,
            estimatedTokens: 200,
            durationMs: 25,
        });
        events = collector.getEvents();
        expect(events).toHaveLength(5);
        expect(events[4].kind).toBe("context_build");
        // Close session
        collector.closeSession(sessionId, Date.now());
        events = collector.getEvents();
        expect(events[0].endedAt).toBeDefined();
    });
    it("should maintain parent-child relationships", async () => {
        const sessionId = "session-2";
        const options = {
            collector,
            workspaceId: "workspace-1",
        };
        collector.startSession(sessionId, options);
        collector.startTurn(sessionId, 0);
        collector.recordLlmCall({
            sessionId,
            model: "gpt-4",
            provider: "openai",
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0.001,
            stopReason: "stop",
            endedAt: Date.now(),
        });
        const events = collector.getEvents();
        const sessionEvent = events.find((e) => e.kind === "session");
        const turnEvent = events.find((e) => e.kind === "turn");
        const llmEvent = events.find((e) => e.kind === "llm_call");
        // Check parent-child chain
        expect(sessionEvent).toBeDefined();
        expect(turnEvent?.parentId).toBe(sessionEvent?.eventId);
        expect(llmEvent?.parentId).toBe(turnEvent?.eventId);
    });
    it("should estimate tokens from messages", () => {
        const messages = [
            "Hello, this is a test message with roughly 10 tokens.",
            { content: "Another message as an object." },
        ];
        const tokens = estimateTokens(messages);
        expect(tokens).toBeGreaterThan(0);
        expect(tokens).toBeLessThan(100); // Should be reasonable estimate
    });
    it("should clear all events", async () => {
        const sessionId = "session-3";
        const options = {
            collector,
            workspaceId: "workspace-1",
        };
        collector.startSession(sessionId, options);
        let events = collector.getEvents();
        expect(events.length).toBeGreaterThan(0);
        collector.clear();
        events = collector.getEvents();
        expect(events).toHaveLength(0);
    });
    it("should attribute events correctly", async () => {
        const sessionId = "session-4";
        const options = {
            collector,
            workspaceId: "workspace-1",
            feature: "user-search",
            prNumber: "123",
            engineerId: "alice",
            projectId: "project-x",
        };
        collector.startSession(sessionId, options);
        const events = collector.getEvents();
        const sessionEvent = events[0];
        expect(sessionEvent.feature).toBe("user-search");
        expect(sessionEvent.prNumber).toBe("123");
        expect(sessionEvent.engineerId).toBe("alice");
        expect(sessionEvent.projectId).toBe("project-x");
    });
});
//# sourceMappingURL=index.test.js.map