import { QueryEvent, QuerySession, QueryWorkspace } from "./schema.js";
/**
 * SQLiteStore — local development database interface
 *
 * IMPORTANT: For MVP, this is stubbed out to avoid better-sqlite3 build issues.
 * The schema and types are complete; just swap in your SQL database driver.
 *
 * This class defines the interface. To use:
 * 1. Install your preferred SQLite driver (better-sqlite3, sql.js, etc.)
 * 2. Implement the methods in this class
 * 3. Or use PostgreSQL directly in production
 *
 * All methods are documented but not implemented for the MVP.
 */
export declare class SQLiteStore {
    private db;
    constructor(dbPath?: string);
    /**
     * Create a workspace
     */
    createWorkspace(id: string, name: string, plan?: "free" | "pro" | "business"): void;
    /**
     * Get workspace by ID
     */
    getWorkspace(id: string): QueryWorkspace | undefined;
    /**
     * Insert a session
     */
    insertSession(session: QuerySession): void;
    /**
     * Get session by ID
     */
    getSession(id: string): QuerySession | undefined;
    /**
     * Get all sessions for a workspace
     */
    getSessions(workspaceId: string, limit?: number, offset?: number): QuerySession[];
    /**
     * Update session totals
     */
    updateSessionTotals(sessionId: string, totalCostUsd: number, totalTokens: number, turnCount: number, loopDetected?: 0 | 1): void;
    /**
     * Insert an event
     */
    insertEvent(event: QueryEvent): void;
    /**
     * Get all events for a session
     */
    getSessionEvents(sessionId: string): QueryEvent[];
    /**
     * Get cost breakdown for a workspace
     */
    getCostBreakdown(workspaceId: string, groupBy?: "tool" | "model" | "feature" | "engineer"): Record<string, {
        cost: number;
        tokens: number;
        count: number;
    }>;
    /**
     * Get loop detection results for a session
     */
    detectLoops(sessionId: string): string[];
    /**
     * Close the database connection
     */
    close(): void;
}
//# sourceMappingURL=sqlite-store.d.ts.map