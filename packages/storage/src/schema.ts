/**
 * Database schema for flamegraph storage
 * Compatible with both SQLite and PostgreSQL
 */

export const SCHEMA_VERSION = 1;

/**
 * SQL statements to initialize the schema
 * These work in both SQLite and PostgreSQL
 */
export const SCHEMA_INIT_SQL = [
  // Workspaces
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,
    created_at INTEGER NOT NULL
  )`,

  // Sessions
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    feature TEXT,
    pr_number TEXT,
    engineer_id TEXT,
    project_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    total_cost_usd REAL DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    turn_count INTEGER DEFAULT 0,
    loop_detected INTEGER DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  )`,

  // Events (the main table)
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    parent_id TEXT,
    workspace_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    model TEXT,
    provider TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    cost_usd REAL,
    stop_reason TEXT,
    tool_name TEXT,
    tool_call_id TEXT,
    tool_input_bytes INTEGER,
    tool_output_bytes INTEGER,
    is_error INTEGER,
    context_messages INTEGER,
    context_token_estimate INTEGER,
    feature TEXT,
    pr_number TEXT,
    engineer_id TEXT,
    metadata TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`,

  // Indexes for common queries
  `CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_events_tool ON events(tool_name)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)`,

  // Alerts
  `CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    condition TEXT NOT NULL,
    threshold REAL,
    webhook_url TEXT,
    email TEXT,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  )`,

  // Alert history
  `CREATE TABLE IF NOT EXISTS alert_fires (
    id TEXT PRIMARY KEY,
    alert_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    fired_at INTEGER NOT NULL,
    details TEXT,
    FOREIGN KEY (alert_id) REFERENCES alerts(id),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_alert_fires_alert ON alert_fires(alert_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_fires_session ON alert_fires(session_id)`,
];

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
