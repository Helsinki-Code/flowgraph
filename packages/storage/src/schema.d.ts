/**
 * Database schema for flamegraph storage
 * Compatible with both SQLite and PostgreSQL
 */
export declare const SCHEMA_VERSION = 1;
/**
 * SQL statements to initialize the schema
 * These work in both SQLite and PostgreSQL
 */
export declare const SCHEMA_INIT_SQL: string[];
/**
 * Query types for type-safe database operations
 */
export interface QuerySession {
    id: string;
    workspace_id: string;
    feature?: string;
    pr_number?: string;
    engineer_id?: string;
    project_id?: string;
    started_at: number;
    ended_at?: number;
    total_cost_usd: number;
    total_tokens: number;
    turn_count: number;
    loop_detected: 0 | 1;
}
export interface QueryEvent {
    id: string;
    session_id: string;
    parent_id?: string;
    workspace_id: string;
    kind: string;
    started_at: number;
    ended_at?: number;
    model?: string;
    provider?: string;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    cost_usd?: number;
    stop_reason?: string;
    tool_name?: string;
    tool_call_id?: string;
    tool_input_bytes?: number;
    tool_output_bytes?: number;
    is_error?: 0 | 1;
    context_messages?: number;
    context_token_estimate?: number;
    feature?: string;
    pr_number?: string;
    engineer_id?: string;
    metadata?: string;
}
export interface QueryWorkspace {
    id: string;
    name: string;
    plan: "free" | "pro" | "business";
    stripe_customer_id?: string;
    created_at: number;
}
export interface QueryAlert {
    id: string;
    workspace_id: string;
    name: string;
    condition: string;
    threshold?: number;
    webhook_url?: string;
    email?: string;
    enabled: 0 | 1;
    created_at: number;
}
//# sourceMappingURL=schema.d.ts.map