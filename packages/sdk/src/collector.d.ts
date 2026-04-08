import { EventCollector, FlamegraphEvent, InstrumentOptions, LlmCallData, ToolExecStartData, ToolExecEndData, ContextBuildData } from "./event-model.js";
/**
 * LocalCollector — buffers events in memory and batches them
 * Used by SDKs for local development and testing
 * Implements EventCollector interface
 */
export declare class LocalCollector implements EventCollector {
    private events;
    private sessions;
    private options;
    private flushInterval?;
    private serverUrl?;
    private apiKey?;
    constructor(options?: {
        autoFlushIntervalMs?: number;
        serverUrl?: string;
        apiKey?: string;
    });
    startSession(sessionId: string, options: InstrumentOptions): void;
    startTurn(sessionId: string, turnIndex: number): void;
    recordLlmCall(data: LlmCallData): void;
    startToolExec(data: ToolExecStartData): void;
    endToolExec(data: ToolExecEndData): void;
    recordContextBuild(data: ContextBuildData): void;
    closeSession(sessionId: string, endedAt: number): void;
    flush(): Promise<void>;
    /**
     * Get all events collected so far
     * Useful for testing
     */
    getEvents(): FlamegraphEvent[];
    /**
     * Clear all events
     */
    clear(): void;
    /**
     * Cleanup (stop auto-flush interval if running)
     */
    destroy(): void;
}
/**
 * Utility: estimate tokens from message array using character count heuristic
 * ~4 chars per token (rough average)
 */
export declare function estimateTokens(messages: any[]): number;
//# sourceMappingURL=collector.d.ts.map