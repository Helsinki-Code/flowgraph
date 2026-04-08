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
export class SQLiteStore {
    constructor(dbPath = ":memory:") {
        // For MVP, this is a stub. Replace with your SQLite driver of choice.
        // Example with better-sqlite3:
        // const Database = require('better-sqlite3');
        // this.db = new Database(dbPath);
        // this.db.pragma("journal_mode = WAL");
        // this.initialize();
        throw new Error("SQLiteStore is stubbed for MVP. Implement with your preferred SQL driver (better-sqlite3, sql.js, PostgreSQL, etc.). See schema.ts for the schema definition.");
    }
    /**
     * Create a workspace
     */
    createWorkspace(id, name, plan = "free") {
        // const stmt = this.db.prepare(`
        //   INSERT INTO workspaces (id, name, plan, created_at)
        //   VALUES (?, ?, ?, ?)
        // `);
        // stmt.run(id, name, plan, Date.now());
    }
    /**
     * Get workspace by ID
     */
    getWorkspace(id) {
        return undefined;
    }
    /**
     * Insert a session
     */
    insertSession(session) {
        // Implementation stub
    }
    /**
     * Get session by ID
     */
    getSession(id) {
        return undefined;
    }
    /**
     * Get all sessions for a workspace
     */
    getSessions(workspaceId, limit = 100, offset = 0) {
        return [];
    }
    /**
     * Update session totals
     */
    updateSessionTotals(sessionId, totalCostUsd, totalTokens, turnCount, loopDetected = 0) {
        // Implementation stub
    }
    /**
     * Insert an event
     */
    insertEvent(event) {
        // Implementation stub
    }
    /**
     * Get all events for a session
     */
    getSessionEvents(sessionId) {
        return [];
    }
    /**
     * Get cost breakdown for a workspace
     */
    getCostBreakdown(workspaceId, groupBy = "tool") {
        return {};
    }
    /**
     * Get loop detection results for a session
     */
    detectLoops(sessionId) {
        return [];
    }
    /**
     * Close the database connection
     */
    close() {
        // Implementation stub
    }
}
//# sourceMappingURL=sqlite-store.js.map