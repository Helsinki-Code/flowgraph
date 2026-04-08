import { SCHEMA_INIT_SQL, QueryEvent, QuerySession, QueryWorkspace } from "./schema.js";

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
  private db: any;

  constructor(dbPath: string = ":memory:") {
    // For MVP, this is a stub. Replace with your SQLite driver of choice.
    // Example with better-sqlite3:
    // const Database = require('better-sqlite3');
    // this.db = new Database(dbPath);
    // this.db.pragma("journal_mode = WAL");
    // this.initialize();

    throw new Error(
      "SQLiteStore is stubbed for MVP. Implement with your preferred SQL driver (better-sqlite3, sql.js, PostgreSQL, etc.). See schema.ts for the schema definition.",
    );
  }

  /**
   * Create a workspace
   */
  createWorkspace(
    id: string,
    name: string,
    plan: "free" | "pro" | "business" = "free",
  ): void {
    // const stmt = this.db.prepare(`
    //   INSERT INTO workspaces (id, name, plan, created_at)
    //   VALUES (?, ?, ?, ?)
    // `);
    // stmt.run(id, name, plan, Date.now());
  }

  /**
   * Get workspace by ID
   */
  getWorkspace(id: string): QueryWorkspace | undefined {
    return undefined;
  }

  /**
   * Insert a session
   */
  insertSession(session: QuerySession): void {
    // Implementation stub
  }

  /**
   * Get session by ID
   */
  getSession(id: string): QuerySession | undefined {
    return undefined;
  }

  /**
   * Get all sessions for a workspace
   */
  getSessions(workspaceId: string, limit: number = 100, offset: number = 0): QuerySession[] {
    return [];
  }

  /**
   * Update session totals
   */
  updateSessionTotals(
    sessionId: string,
    totalCostUsd: number,
    totalTokens: number,
    turnCount: number,
    loopDetected: 0 | 1 = 0,
  ): void {
    // Implementation stub
  }

  /**
   * Insert an event
   */
  insertEvent(event: QueryEvent): void {
    // Implementation stub
  }

  /**
   * Get all events for a session
   */
  getSessionEvents(sessionId: string): QueryEvent[] {
    return [];
  }

  /**
   * Get cost breakdown for a workspace
   */
  getCostBreakdown(
    workspaceId: string,
    groupBy: "tool" | "model" | "feature" | "engineer" = "tool",
  ): Record<string, { cost: number; tokens: number; count: number }> {
    return {};
  }

  /**
   * Get loop detection results for a session
   */
  detectLoops(sessionId: string): string[] {
    return [];
  }

  /**
   * Close the database connection
   */
  close(): void {
    // Implementation stub
  }
}
