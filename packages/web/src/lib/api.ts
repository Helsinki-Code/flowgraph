/**
 * API client for flamegraph server
 */

export const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:3000";

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  token?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${API_URL}${path}`;
  const { token, ...requestInit } = options;
  const response = await fetch(url, {
    method: requestInit.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...requestInit.headers,
    },
    body: requestInit.body ? JSON.stringify(requestInit.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} ${error}`);
  }

  return response.json();
}

export interface Session {
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

export interface FlameNode {
  id: string;
  name: string;
  kind: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  costUsd: number;
  tokens: number;
  pctOfTotal: number;
  children: FlameNode[];
  toolName?: string;
  model?: string;
  isError?: boolean;
  loopFlag?: boolean;
}

export const api = {
  getSessions: (workspaceId: string, limit = 100, offset = 0) =>
    request<{ sessions: Session[] }>(
      `/v1/sessions?workspace_id=${workspaceId}&limit=${limit}&offset=${offset}`,
    ),

  getSession: (sessionId: string) =>
    request<{ session: Session; events: any[] }>(`/v1/sessions/${sessionId}`),

  getFlameGraph: (sessionId: string) =>
    request<{ tree: FlameNode; metrics: any }>(`/v1/sessions/${sessionId}/flamegraph`),

  getCostBreakdown: (workspaceId: string, groupBy = "tool") =>
    request<{ breakdown: Record<string, any>; groupBy: string }>(
      `/v1/cost/breakdown?workspace_id=${workspaceId}&group_by=${groupBy}`,
    ),

  getHealth: () => request<{ ok: boolean }>("/health"),
};
