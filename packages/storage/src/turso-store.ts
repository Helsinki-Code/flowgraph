import { createClient } from "@libsql/client";
import { SCHEMA_INIT_SQL, QueryEvent, QuerySession, QueryWorkspace } from "./schema.js";

/**
 * TursoStore — Production database backed by Turso (hosted LibSQL)
 * HTTP-based SQLite, no native module compilation needed
 */
export class TursoStore {
  private client = createClient({
    url: process.env.DATABASE_URL!,
    authToken: process.env.DATABASE_TOKEN!,
  });

  async initialize(): Promise<void> {
    for (const sql of SCHEMA_INIT_SQL) {
      await this.client.execute(sql);
    }
    console.log("[turso] Database initialized");
  }

  /**
   * Create a workspace
   */
  async createWorkspace(
    id: string,
    name: string,
    plan: "free" | "pro" | "business" = "free",
  ): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO workspaces (id, name, plan, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, name, plan, Date.now()],
    });
  }

  /**
   * Get workspace by ID
   */
  async getWorkspace(id: string): Promise<QueryWorkspace | undefined> {
    const result = await this.client.execute({
      sql: "SELECT * FROM workspaces WHERE id = ?",
      args: [id],
    });
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      id: row.id as string,
      name: row.name as string,
      plan: row.plan as "free" | "pro" | "business",
      stripe_customer_id: row.stripe_customer_id as string | undefined,
      created_at: row.created_at as number,
    };
  }

  /**
   * Insert a session
   */
  async insertSession(session: QuerySession): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO sessions (id, workspace_id, feature, pr_number, engineer_id, project_id, started_at, ended_at, total_cost_usd, total_tokens, turn_count, loop_detected)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        session.id,
        session.workspace_id,
        session.feature || null,
        session.pr_number || null,
        session.engineer_id || null,
        session.project_id || null,
        session.started_at,
        session.ended_at || null,
        session.total_cost_usd,
        session.total_tokens,
        session.turn_count,
        session.loop_detected,
      ],
    });
  }

  /**
   * Get session by ID
   */
  async getSession(id: string): Promise<QuerySession | undefined> {
    const result = await this.client.execute({
      sql: "SELECT * FROM sessions WHERE id = ?",
      args: [id],
    });
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    return {
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      feature: row.feature as string | undefined,
      pr_number: row.pr_number as string | undefined,
      engineer_id: row.engineer_id as string | undefined,
      project_id: row.project_id as string | undefined,
      started_at: row.started_at as number,
      ended_at: row.ended_at as number | undefined,
      total_cost_usd: row.total_cost_usd as number,
      total_tokens: row.total_tokens as number,
      turn_count: row.turn_count as number,
      loop_detected: row.loop_detected as 0 | 1,
    };
  }

  /**
   * Get all sessions for a workspace with pagination
   */
  async getSessions(
    workspaceId: string,
    limit: number = 100,
    offset: number = 0,
  ): Promise<QuerySession[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`,
      args: [workspaceId, limit, offset],
    });

    return result.rows.map((row) => ({
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      feature: row.feature as string | undefined,
      pr_number: row.pr_number as string | undefined,
      engineer_id: row.engineer_id as string | undefined,
      project_id: row.project_id as string | undefined,
      started_at: row.started_at as number,
      ended_at: row.ended_at as number | undefined,
      total_cost_usd: row.total_cost_usd as number,
      total_tokens: row.total_tokens as number,
      turn_count: row.turn_count as number,
      loop_detected: row.loop_detected as 0 | 1,
    }));
  }

  /**
   * Update session totals
   */
  async updateSessionTotals(
    sessionId: string,
    totalCostUsd: number,
    totalTokens: number,
    turnCount: number,
    loopDetected: 0 | 1 = 0,
  ): Promise<void> {
    await this.client.execute({
      sql: `UPDATE sessions SET total_cost_usd = ?, total_tokens = ?, turn_count = ?, loop_detected = ? WHERE id = ?`,
      args: [totalCostUsd, totalTokens, turnCount, loopDetected, sessionId],
    });
  }

  /**
   * Insert an event
   */
  async insertEvent(event: QueryEvent): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO events (id, session_id, parent_id, workspace_id, kind, started_at, ended_at, model, provider, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, stop_reason, tool_name, tool_call_id, tool_input_bytes, tool_output_bytes, is_error, context_messages, context_token_estimate, feature, pr_number, engineer_id, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        event.id,
        event.session_id,
        event.parent_id || null,
        event.workspace_id,
        event.kind,
        event.started_at,
        event.ended_at || null,
        event.model || null,
        event.provider || null,
        event.input_tokens || null,
        event.output_tokens || null,
        event.cache_read_tokens || null,
        event.cache_write_tokens || null,
        event.cost_usd || null,
        event.stop_reason || null,
        event.tool_name || null,
        event.tool_call_id || null,
        event.tool_input_bytes || null,
        event.tool_output_bytes || null,
        event.is_error || null,
        event.context_messages || null,
        event.context_token_estimate || null,
        event.feature || null,
        event.pr_number || null,
        event.engineer_id || null,
        event.metadata || null,
      ],
    });
  }

  /**
   * Get all events for a session
   */
  async getSessionEvents(sessionId: string): Promise<QueryEvent[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM events WHERE session_id = ? ORDER BY started_at ASC`,
      args: [sessionId],
    });

    return result.rows.map((row) => ({
      id: row.id as string,
      session_id: row.session_id as string,
      parent_id: row.parent_id as string | undefined,
      workspace_id: row.workspace_id as string,
      kind: row.kind as string,
      started_at: row.started_at as number,
      ended_at: row.ended_at as number | undefined,
      model: row.model as string | undefined,
      provider: row.provider as string | undefined,
      input_tokens: row.input_tokens as number | undefined,
      output_tokens: row.output_tokens as number | undefined,
      cache_read_tokens: row.cache_read_tokens as number | undefined,
      cache_write_tokens: row.cache_write_tokens as number | undefined,
      cost_usd: row.cost_usd as number | undefined,
      stop_reason: row.stop_reason as string | undefined,
      tool_name: row.tool_name as string | undefined,
      tool_call_id: row.tool_call_id as string | undefined,
      tool_input_bytes: row.tool_input_bytes as number | undefined,
      tool_output_bytes: row.tool_output_bytes as number | undefined,
      is_error: row.is_error as 0 | 1 | undefined,
      context_messages: row.context_messages as number | undefined,
      context_token_estimate: row.context_token_estimate as number | undefined,
      feature: row.feature as string | undefined,
      pr_number: row.pr_number as string | undefined,
      engineer_id: row.engineer_id as string | undefined,
      metadata: row.metadata as string | undefined,
    }));
  }

  /**
   * Get cost breakdown grouped by tool, model, feature, or engineer
   */
  async getCostBreakdown(
    workspaceId: string,
    groupBy: "tool" | "model" | "feature" | "engineer" = "tool",
  ): Promise<Record<string, { cost: number; tokens: number; count: number }>> {
    let groupField = "tool_name";
    if (groupBy === "model") groupField = "model";
    if (groupBy === "feature") groupField = "feature";
    if (groupBy === "engineer") groupField = "engineer_id";

    const result = await this.client.execute({
      sql: `SELECT ${groupField} as key, SUM(cost_usd) as cost, SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as tokens, COUNT(*) as count
            FROM events
            WHERE workspace_id = ? AND kind = 'llm_call'
            GROUP BY ${groupField}
            ORDER BY cost DESC`,
      args: [workspaceId],
    });

    const breakdown: Record<string, { cost: number; tokens: number; count: number }> = {};
    for (const row of result.rows) {
      const key = (row.key as string) || "unknown";
      breakdown[key] = {
        cost: (row.cost as number) || 0,
        tokens: (row.tokens as number) || 0,
        count: (row.count as number) || 0,
      };
    }
    return breakdown;
  }

  /**
   * Detect loops in a session (same tool called 3+ times consecutively)
   */
  async detectLoops(sessionId: string): Promise<string[]> {
    const result = await this.client.execute({
      sql: `SELECT tool_name FROM events WHERE session_id = ? AND kind = 'tool_exec' ORDER BY started_at ASC`,
      args: [sessionId],
    });

    const toolNames = result.rows.map((row) => row.tool_name as string);
    const loopedTools: string[] = [];

    let currentTool = "";
    let count = 0;
    for (const tool of toolNames) {
      if (tool === currentTool) {
        count++;
        if (count >= 3 && !loopedTools.includes(currentTool)) {
          loopedTools.push(currentTool);
        }
      } else {
        currentTool = tool;
        count = 1;
      }
    }

    return loopedTools;
  }

  /**
   * Create an alert
   */
  async createAlert(
    id: string,
    workspaceId: string,
    name: string,
    condition: string,
    threshold?: number,
    webhookUrl?: string,
    email?: string,
  ): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO alerts (id, workspace_id, name, condition, threshold, webhook_url, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, workspaceId, name, condition, threshold || null, webhookUrl || null, email || null, Date.now()],
    });
  }

  /**
   * Get all alerts for a workspace
   */
  async getAlerts(workspaceId: string): Promise<any[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM alerts WHERE workspace_id = ? ORDER BY created_at DESC`,
      args: [workspaceId],
    });
    return result.rows;
  }

  /**
   * Delete an alert
   */
  async deleteAlert(alertId: string): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM alerts WHERE id = ?`,
      args: [alertId],
    });
  }

  /**
   * Record an alert fire event
   */
  async fireAlert(alertId: string, sessionId: string, details?: any): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO alert_fires (id, alert_id, session_id, fired_at, details) VALUES (?, ?, ?, ?, ?)`,
      args: [
        `fire-${Date.now()}`,
        alertId,
        sessionId,
        Date.now(),
        details ? JSON.stringify(details) : null,
      ],
    });
  }

  /**
   * Close database connection (if needed)
   */
  async close(): Promise<void> {
    // Turso HTTP client doesn't require explicit close
  }
}
