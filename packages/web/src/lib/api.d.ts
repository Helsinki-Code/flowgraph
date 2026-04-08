/**
 * API client for flamegraph server
 */
export declare const API_URL: any;
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
export declare const api: {
    getSessions: (workspaceId: string, limit?: number, offset?: number) => Promise<{
        sessions: Session[];
    }>;
    getSession: (sessionId: string) => Promise<{
        session: Session;
        events: any[];
    }>;
    getFlameGraph: (sessionId: string) => Promise<{
        tree: FlameNode;
        metrics: any;
    }>;
    getCostBreakdown: (workspaceId: string, groupBy?: string) => Promise<{
        breakdown: Record<string, any>;
        groupBy: string;
    }>;
    getHealth: () => Promise<{
        ok: boolean;
    }>;
};
//# sourceMappingURL=api.d.ts.map