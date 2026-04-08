import type { QueryEvent } from "@flamegraph/storage";
/**
 * FlameNode — tree structure consumed by D3 for visualization
 */
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
/**
 * Build a flame graph tree from flat events
 * Events must be sorted by startedAt ascending
 */
export declare function buildFlameTree(events: QueryEvent[]): FlameNode | null;
/**
 * Compute aggregated metrics for a flame tree
 */
export declare function computeTreeMetrics(root: FlameNode | null): {
    totalCost: number;
    totalTokens: number;
    maxDepth: number;
    nodeCount: number;
};
//# sourceMappingURL=builder.d.ts.map