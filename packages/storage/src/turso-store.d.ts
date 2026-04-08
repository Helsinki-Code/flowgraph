import { QueryEvent, QuerySession, QueryWorkspace } from "./schema.js";
/**
 * TursoStore — Production database backed by Turso (hosted LibSQL)
 * HTTP-based SQLite, no native module compilation needed
 */
export declare class TursoStore {
    private client;
    initialize(): Promise<void>;
    /**
     * Create a workspace
     */
    createWorkspace(id: string, name: string, plan?: "free" | "pro" | "business"): Promise<void>;
    /**
     * Get workspace by ID
     */
    getWorkspace(id: string): Promise<QueryWorkspace | undefined>;
    /**
     * Insert a session
     */
    insertSession(session: QuerySession): Promise<void>;
    /**
     * Get session by ID
     */
    getSession(id: string): Promise<QuerySession | undefined>;
    /**
     * Get all sessions for a workspace with pagination
     */
    getSessions(workspaceId: string, limit?: number, offset?: number): Promise<QuerySession[]>;
    /**
     * Update session totals
     */
    updateSessionTotals(sessionId: string, totalCostUsd: number, totalTokens: number, turnCount: number, loopDetected?: 0 | 1): Promise<void>;
    /**
     * Insert an event
     */
    insertEvent(event: QueryEvent): Promise<void>;
    /**
     * Get all events for a session
     */
    getSessionEvents(sessionId: string): Promise<QueryEvent[]>;
    /**
     * Get cost breakdown grouped by tool, model, feature, or engineer
     */
    getCostBreakdown(workspaceId: string, groupBy?: "tool" | "model" | "feature" | "engineer"): Promise<Record<string, {
        cost: number;
        tokens: number;
        count: number;
    }>>;
    /**
     * Detect loops in a session (same tool called 3+ times consecutively)
     */
    detectLoops(sessionId: string): Promise<string[]>;
    /**
     * Create an alert
     */
    createAlert(id: string, workspaceId: string, name: string, condition: string, threshold?: number, webhookUrl?: string, email?: string): Promise<void>;
    /**
     * Get all alerts for a workspace
     */
    getAlerts(workspaceId: string): Promise<any[]>;
    /**
     * Delete an alert
     */
    deleteAlert(alertId: string): Promise<void>;
    /**
     * Record an alert fire event
     */
    fireAlert(alertId: string, sessionId: string, details?: any): Promise<void>;
    /**
     * Close database connection (if needed)
     */
    close(): Promise<void>;
}
//# sourceMappingURL=turso-store.d.ts.map