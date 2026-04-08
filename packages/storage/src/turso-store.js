import { createClient } from "@libsql/client";
import { SCHEMA_INIT_SQL } from "./schema.js";
/**
 * TursoStore — Production database backed by Turso (hosted LibSQL)
 * HTTP-based SQLite, no native module compilation needed
 */
export class TursoStore {
    constructor() {
        this.client = createClient({
            url: process.env.DATABASE_URL,
            authToken: process.env.DATABASE_TOKEN,
        });
    }
    async initialize() {
        for (const sql of SCHEMA_INIT_SQL) {
            await this.client.execute(sql);
        }
        console.log("[turso] Database initialized");
    }
    /**
     * Create a workspace
     */
    async createWorkspace(id, name, plan = "free") {
        await this.client.execute({
            sql: `INSERT INTO workspaces (id, name, plan, created_at) VALUES (?, ?, ?, ?)`,
            args: [id, name, plan, Date.now()],
        });
    }
    /**
     * Get workspace by ID
     */
    async getWorkspace(id) {
        const result = await this.client.execute({
            sql: "SELECT * FROM workspaces WHERE id = ?",
            args: [id],
        });
        if (result.rows.length === 0)
            return undefined;
        const row = result.rows[0];
        return {
            id: row.id,
            name: row.name,
            plan: row.plan,
            stripe_customer_id: row.stripe_customer_id,
            created_at: row.created_at,
        };
    }
    /**
     * Insert a session
     */
    async insertSession(session) {
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
    async getSession(id) {
        const result = await this.client.execute({
            sql: "SELECT * FROM sessions WHERE id = ?",
            args: [id],
        });
        if (result.rows.length === 0)
            return undefined;
        const row = result.rows[0];
        return {
            id: row.id,
            workspace_id: row.workspace_id,
            feature: row.feature,
            pr_number: row.pr_number,
            engineer_id: row.engineer_id,
            project_id: row.project_id,
            started_at: row.started_at,
            ended_at: row.ended_at,
            total_cost_usd: row.total_cost_usd,
            total_tokens: row.total_tokens,
            turn_count: row.turn_count,
            loop_detected: row.loop_detected,
        };
    }
    /**
     * Get all sessions for a workspace with pagination
     */
    async getSessions(workspaceId, limit = 100, offset = 0) {
        const result = await this.client.execute({
            sql: `SELECT * FROM sessions WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`,
            args: [workspaceId, limit, offset],
        });
        return result.rows.map((row) => ({
            id: row.id,
            workspace_id: row.workspace_id,
            feature: row.feature,
            pr_number: row.pr_number,
            engineer_id: row.engineer_id,
            project_id: row.project_id,
            started_at: row.started_at,
            ended_at: row.ended_at,
            total_cost_usd: row.total_cost_usd,
            total_tokens: row.total_tokens,
            turn_count: row.turn_count,
            loop_detected: row.loop_detected,
        }));
    }
    /**
     * Update session totals
     */
    async updateSessionTotals(sessionId, totalCostUsd, totalTokens, turnCount, loopDetected = 0) {
        await this.client.execute({
            sql: `UPDATE sessions SET total_cost_usd = ?, total_tokens = ?, turn_count = ?, loop_detected = ? WHERE id = ?`,
            args: [totalCostUsd, totalTokens, turnCount, loopDetected, sessionId],
        });
    }
    /**
     * Insert an event
     */
    async insertEvent(event) {
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
    async getSessionEvents(sessionId) {
        const result = await this.client.execute({
            sql: `SELECT * FROM events WHERE session_id = ? ORDER BY started_at ASC`,
            args: [sessionId],
        });
        return result.rows.map((row) => ({
            id: row.id,
            session_id: row.session_id,
            parent_id: row.parent_id,
            workspace_id: row.workspace_id,
            kind: row.kind,
            started_at: row.started_at,
            ended_at: row.ended_at,
            model: row.model,
            provider: row.provider,
            input_tokens: row.input_tokens,
            output_tokens: row.output_tokens,
            cache_read_tokens: row.cache_read_tokens,
            cache_write_tokens: row.cache_write_tokens,
            cost_usd: row.cost_usd,
            stop_reason: row.stop_reason,
            tool_name: row.tool_name,
            tool_call_id: row.tool_call_id,
            tool_input_bytes: row.tool_input_bytes,
            tool_output_bytes: row.tool_output_bytes,
            is_error: row.is_error,
            context_messages: row.context_messages,
            context_token_estimate: row.context_token_estimate,
            feature: row.feature,
            pr_number: row.pr_number,
            engineer_id: row.engineer_id,
            metadata: row.metadata,
        }));
    }
    /**
     * Get cost breakdown grouped by tool, model, feature, or engineer
     */
    async getCostBreakdown(workspaceId, groupBy = "tool") {
        let groupField = "tool_name";
        if (groupBy === "model")
            groupField = "model";
        if (groupBy === "feature")
            groupField = "feature";
        if (groupBy === "engineer")
            groupField = "engineer_id";
        const result = await this.client.execute({
            sql: `SELECT ${groupField} as key, SUM(cost_usd) as cost, SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as tokens, COUNT(*) as count
            FROM events
            WHERE workspace_id = ? AND kind = 'llm_call'
            GROUP BY ${groupField}
            ORDER BY cost DESC`,
            args: [workspaceId],
        });
        const breakdown = {};
        for (const row of result.rows) {
            const key = row.key || "unknown";
            breakdown[key] = {
                cost: row.cost || 0,
                tokens: row.tokens || 0,
                count: row.count || 0,
            };
        }
        return breakdown;
    }
    /**
     * Detect loops in a session (same tool called 3+ times consecutively)
     */
    async detectLoops(sessionId) {
        const result = await this.client.execute({
            sql: `SELECT tool_name FROM events WHERE session_id = ? AND kind = 'tool_exec' ORDER BY started_at ASC`,
            args: [sessionId],
        });
        const toolNames = result.rows.map((row) => row.tool_name);
        const loopedTools = [];
        let currentTool = "";
        let count = 0;
        for (const tool of toolNames) {
            if (tool === currentTool) {
                count++;
                if (count >= 3 && !loopedTools.includes(currentTool)) {
                    loopedTools.push(currentTool);
                }
            }
            else {
                currentTool = tool;
                count = 1;
            }
        }
        return loopedTools;
    }
    /**
     * Create an alert
     */
    async createAlert(id, workspaceId, name, condition, threshold, webhookUrl, email) {
        await this.client.execute({
            sql: `INSERT INTO alerts (id, workspace_id, name, condition, threshold, webhook_url, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [id, workspaceId, name, condition, threshold || null, webhookUrl || null, email || null, Date.now()],
        });
    }
    /**
     * Get all alerts for a workspace
     */
    async getAlerts(workspaceId) {
        const result = await this.client.execute({
            sql: `SELECT * FROM alerts WHERE workspace_id = ? ORDER BY created_at DESC`,
            args: [workspaceId],
        });
        return result.rows;
    }
    /**
     * Delete an alert
     */
    async deleteAlert(alertId) {
        await this.client.execute({
            sql: `DELETE FROM alerts WHERE id = ?`,
            args: [alertId],
        });
    }
    /**
     * Record an alert fire event
     */
    async fireAlert(alertId, sessionId, details) {
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
    async close() {
        // Turso HTTP client doesn't require explicit close
    }
}
//# sourceMappingURL=turso-store.js.map