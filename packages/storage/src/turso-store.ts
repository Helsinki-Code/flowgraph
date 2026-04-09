import { createClient } from "@libsql/client";
import {
  SCHEMA_INIT_SQL,
  QueryApiKey,
  QueryBudget,
  QueryBudgetViolation,
  QueryEvent,
  QuerySession,
  QueryWorkspace,
} from "./schema.js";

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
   * Create a workspace (or ignore if already exists)
   */
  async createWorkspace(
    id: string,
    name: string,
    plan: "free" | "pro" | "business" = "free",
  ): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO workspaces (id, name, plan, created_at) VALUES (?, ?, ?, ?)`,
      args: [id, name, plan, Date.now()],
    });
  }

  async updateWorkspacePlan(
    workspaceId: string,
    plan: "free" | "pro" | "business",
    stripeCustomerId?: string,
  ): Promise<void> {
    await this.client.execute({
      sql: `UPDATE workspaces SET plan = ?, stripe_customer_id = COALESCE(?, stripe_customer_id) WHERE id = ?`,
      args: [plan, stripeCustomerId || null, workspaceId],
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
      sql: `INSERT OR IGNORE INTO sessions (id, workspace_id, feature, pr_number, engineer_id, project_id, started_at, ended_at, total_cost_usd, total_tokens, turn_count, loop_detected)
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
   * Get session by ID, scoped to workspace
   */
  async getSessionForWorkspace(
    sessionId: string,
    workspaceId: string,
  ): Promise<QuerySession | undefined> {
    const result = await this.client.execute({
      sql: "SELECT * FROM sessions WHERE id = ? AND workspace_id = ?",
      args: [sessionId, workspaceId],
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
   * Count sessions in the current UTC month for billing/usage displays
   */
  async getSessionCountForCurrentMonth(workspaceId: string): Promise<number> {
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
    const nextMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
    const result = await this.client.execute({
      sql: `SELECT COUNT(*) as count
            FROM sessions
            WHERE workspace_id = ? AND started_at >= ? AND started_at < ?`,
      args: [workspaceId, monthStart, nextMonthStart],
    });
    return (result.rows[0]?.count as number) || 0;
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
   * Recompute and persist session totals from all persisted events
   */
  async recomputeSessionTotals(sessionId: string, workspaceId: string): Promise<void> {
    const totals = await this.client.execute({
      sql: `SELECT
              COALESCE(SUM(cost_usd), 0) AS total_cost,
              COALESCE(SUM(
                COALESCE(input_tokens, 0) +
                COALESCE(output_tokens, 0) +
                COALESCE(cache_read_tokens, 0) +
                COALESCE(cache_write_tokens, 0)
              ), 0) AS total_tokens,
              COALESCE(SUM(CASE WHEN kind = 'turn' THEN 1 ELSE 0 END), 0) AS turn_count
            FROM events
            WHERE session_id = ? AND workspace_id = ?`,
      args: [sessionId, workspaceId],
    });

    const totalsRow = totals.rows[0];
    const loopedTools = await this.detectLoops(sessionId, workspaceId);
    const loopDetected = loopedTools.length > 0 ? 1 : 0;

    await this.client.execute({
      sql: `UPDATE sessions
            SET total_cost_usd = ?, total_tokens = ?, turn_count = ?, loop_detected = ?
            WHERE id = ? AND workspace_id = ?`,
      args: [
        (totalsRow?.total_cost as number) || 0,
        (totalsRow?.total_tokens as number) || 0,
        (totalsRow?.turn_count as number) || 0,
        loopDetected,
        sessionId,
        workspaceId,
      ],
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
   * Get all events for a session scoped to workspace
   */
  async getSessionEventsForWorkspace(
    sessionId: string,
    workspaceId: string,
  ): Promise<QueryEvent[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM events WHERE session_id = ? AND workspace_id = ? ORDER BY started_at ASC`,
      args: [sessionId, workspaceId],
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
   * Get events for a session newer than a cursor timestamp (inclusive)
   */
  async getSessionEventsSince(
    sessionId: string,
    workspaceId: string,
    sinceStartedAt: number,
    limit: number = 500,
  ): Promise<QueryEvent[]> {
    const safeLimit = Math.max(1, Math.min(limit, 2000));
    const result = await this.client.execute({
      sql: `SELECT * FROM events
            WHERE session_id = ? AND workspace_id = ? AND started_at >= ?
            ORDER BY started_at ASC
            LIMIT ?`,
      args: [sessionId, workspaceId, sinceStartedAt, safeLimit],
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
  async detectLoops(sessionId: string, workspaceId: string): Promise<string[]> {
    const result = await this.client.execute({
      sql: `SELECT tool_name FROM events WHERE session_id = ? AND workspace_id = ? AND kind = 'tool_exec' ORDER BY started_at ASC`,
      args: [sessionId, workspaceId],
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
  async deleteAlert(alertId: string, workspaceId: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: `DELETE FROM alerts WHERE id = ? AND workspace_id = ?`,
      args: [alertId, workspaceId],
    });
    return (result.rowsAffected || 0) > 0;
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
   * Create and store API key hash
   */
  async createApiKey(workspaceId: string, keyHash: string, keyId: string): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO api_keys (id, workspace_id, key_hash, created_at) VALUES (?, ?, ?, ?)`,
      args: [keyId, workspaceId, keyHash, Date.now()],
    });
  }

  /**
   * Validate API key by looking up key hash
   */
  async validateApiKey(keyHash: string): Promise<string | undefined> {
    const result = await this.client.execute({
      sql: `SELECT id, workspace_id FROM api_keys WHERE key_hash = ?`,
      args: [keyHash],
    });
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    await this.client.execute({
      sql: `UPDATE api_keys SET last_used_at = ? WHERE id = ?`,
      args: [Date.now(), row.id as string],
    });
    return row.workspace_id as string;
  }

  /**
   * List API keys for a workspace
   */
  async listApiKeys(workspaceId: string): Promise<QueryApiKey[]> {
    const result = await this.client.execute({
      sql: `SELECT id, workspace_id, created_at, last_used_at FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC`,
      args: [workspaceId],
    });

    return result.rows.map((row) => ({
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      created_at: row.created_at as number,
      last_used_at: row.last_used_at as number | undefined,
    }));
  }

  /**
   * Revoke one API key by ID, scoped to workspace
   */
  async revokeApiKey(workspaceId: string, keyId: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: `DELETE FROM api_keys WHERE workspace_id = ? AND id = ?`,
      args: [workspaceId, keyId],
    });
    return (result.rowsAffected || 0) > 0;
  }

  /**
   * Ingest idempotency lookup
   */
  async hasIngestRequest(workspaceId: string, idempotencyKey: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: `SELECT id FROM ingest_requests WHERE workspace_id = ? AND idempotency_key = ? LIMIT 1`,
      args: [workspaceId, idempotencyKey],
    });
    return result.rows.length > 0;
  }

  /**
   * Record idempotency key for a completed ingest request
   */
  async recordIngestRequest(
    id: string,
    workspaceId: string,
    idempotencyKey: string,
    sessionId?: string,
  ): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO ingest_requests (id, workspace_id, idempotency_key, session_id, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, workspaceId, idempotencyKey, sessionId || null, Date.now()],
    });
  }

  /**
   * Create a budget policy
   */
  async createBudget(
    budget: Omit<QueryBudget, "created_at"> & { created_at?: number },
  ): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO budgets
            (id, workspace_id, name, scope, metric, target, limit_value, action, enabled, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        budget.id,
        budget.workspace_id,
        budget.name,
        budget.scope,
        budget.metric,
        budget.target || null,
        budget.limit_value,
        budget.action,
        budget.enabled,
        budget.created_at || Date.now(),
      ],
    });
  }

  /**
   * List budgets for a workspace
   */
  async listBudgets(workspaceId: string, enabledOnly: boolean = false): Promise<QueryBudget[]> {
    const result = await this.client.execute({
      sql: enabledOnly
        ? `SELECT * FROM budgets WHERE workspace_id = ? AND enabled = 1 ORDER BY created_at DESC`
        : `SELECT * FROM budgets WHERE workspace_id = ? ORDER BY created_at DESC`,
      args: [workspaceId],
    });

    return result.rows.map((row) => ({
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      name: row.name as string,
      scope: row.scope as "session" | "agent" | "call",
      metric: row.metric as "cost_usd" | "tokens",
      target: row.target as string | undefined,
      limit_value: row.limit_value as number,
      action: row.action as "warn" | "block",
      enabled: row.enabled as 0 | 1,
      created_at: row.created_at as number,
    }));
  }

  /**
   * Delete a budget policy by id scoped to workspace
   */
  async deleteBudget(workspaceId: string, budgetId: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: `DELETE FROM budgets WHERE workspace_id = ? AND id = ?`,
      args: [workspaceId, budgetId],
    });
    return (result.rowsAffected || 0) > 0;
  }

  /**
   * Record a budget violation/audit event
   */
  async recordBudgetViolation(
    violation: Omit<QueryBudgetViolation, "created_at"> & { created_at?: number },
  ): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO budget_violations
            (id, workspace_id, budget_id, session_id, event_id, scope, target, metric, current_value, limit_value, action, details, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        violation.id,
        violation.workspace_id,
        violation.budget_id,
        violation.session_id || null,
        violation.event_id || null,
        violation.scope,
        violation.target || null,
        violation.metric,
        violation.current_value,
        violation.limit_value,
        violation.action,
        violation.details || null,
        violation.created_at || Date.now(),
      ],
    });
  }

  /**
   * List budget violations for a session
   */
  async listBudgetViolations(
    workspaceId: string,
    sessionId: string,
    limit: number = 50,
  ): Promise<QueryBudgetViolation[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const result = await this.client.execute({
      sql: `SELECT * FROM budget_violations
            WHERE workspace_id = ? AND session_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [workspaceId, sessionId, safeLimit],
    });

    return result.rows.map((row) => ({
      id: row.id as string,
      workspace_id: row.workspace_id as string,
      budget_id: row.budget_id as string,
      session_id: row.session_id as string | undefined,
      event_id: row.event_id as string | undefined,
      scope: row.scope as "session" | "agent" | "call",
      target: row.target as string | undefined,
      metric: row.metric as "cost_usd" | "tokens",
      current_value: row.current_value as number,
      limit_value: row.limit_value as number,
      action: row.action as "warn" | "block",
      details: row.details as string | undefined,
      created_at: row.created_at as number,
    }));
  }

  /**
   * Aggregate session totals grouped by agentId from event metadata
   */
  async getSessionAgentTotals(
    workspaceId: string,
    sessionId: string,
  ): Promise<Record<string, { cost: number; tokens: number }>> {
    const events = await this.getSessionEventsForWorkspace(sessionId, workspaceId);
    const totals: Record<string, { cost: number; tokens: number }> = {};
    for (const event of events) {
      if (event.kind !== "llm_call") continue;
      let agentId = "primary";
      if (event.metadata) {
        try {
          const parsed = JSON.parse(event.metadata) as Record<string, unknown>;
          const raw =
            parsed.agentId || parsed.agent_id || parsed.agent || parsed.actor || parsed.nodeId;
          if (typeof raw === "string" && raw.trim() !== "") {
            agentId = raw.trim();
          }
        } catch {
          // ignore malformed metadata
        }
      }

      const tokens =
        (event.input_tokens || 0) +
        (event.output_tokens || 0) +
        (event.cache_read_tokens || 0) +
        (event.cache_write_tokens || 0);
      const cost = event.cost_usd || 0;
      if (!totals[agentId]) totals[agentId] = { cost: 0, tokens: 0 };
      totals[agentId].cost += cost;
      totals[agentId].tokens += tokens;
    }
    return totals;
  }

  /**
   * Close database connection (if needed)
   */
  async close(): Promise<void> {
    // Turso HTTP client doesn't require explicit close
  }
}
