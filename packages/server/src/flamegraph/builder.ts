import type { QueryEvent } from "@flamegraph/storage";

/**
 * FlameNode — tree structure consumed by D3 for visualization
 */
export interface FlameNode {
  id: string;
  name: string; // "turn:3", "bash", "read", "llm:claude-opus-4-6"
  kind: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  costUsd: number;
  tokens: number;
  pctOfTotal: number; // 0–100, relative to session total
  children: FlameNode[];

  // Display metadata
  toolName?: string;
  model?: string;
  isError?: boolean;
  loopFlag?: boolean; // this tool was called 3+ times as siblings
}

/**
 * Build a flame graph tree from flat events
 * Events must be sorted by startedAt ascending
 */
export function buildFlameTree(events: QueryEvent[]): FlameNode | null {
  const validEvents = (events || []).filter(
    (event) =>
      typeof event?.id === "string" &&
      event.id.length > 0 &&
      typeof event.session_id === "string" &&
      typeof event.started_at === "number",
  );
  if (validEvents.length === 0) return null;

  validEvents.sort((a, b) => a.started_at - b.started_at);

  // Find the root session event, or create synthetic root from event bounds
  let sessionEvent = validEvents.find((e) => e.kind === "session" && !e.parent_id);
  if (!sessionEvent) {
    // Create synthetic root from first and last event timestamps
    const minStart = Math.min(...validEvents.map((e) => e.started_at));
    const maxEnd = Math.max(...validEvents.map((e) => e.ended_at || e.started_at));
    sessionEvent = {
      id: "synthetic-root",
      session_id: validEvents[0].session_id,
      parent_id: undefined,
      workspace_id: validEvents[0].workspace_id,
      kind: "session",
      started_at: minStart,
      ended_at: maxEnd,
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      tool_name: undefined,
      tool_call_id: undefined,
      tool_input_bytes: 0,
      tool_output_bytes: 0,
      is_error: 0,
      model: undefined,
      provider: undefined,
      stop_reason: undefined,
      feature: undefined,
      pr_number: undefined,
      engineer_id: undefined,
      context_messages: 0,
      context_token_estimate: 0,
      metadata: undefined,
    } as QueryEvent;
  }

  // Build a map of id → node for parent/child linking
  const nodeMap = new Map<string, FlameNode>();
  let totalCostUsd = 0;
  let totalTokens = 0;

  // If sessionEvent is synthetic, create and add its node now
  let isRootSynthetic = false;
  if (sessionEvent.id === "synthetic-root") {
    isRootSynthetic = true;
    const durationMs = sessionEvent.ended_at! - sessionEvent.started_at;
    const rootNode: FlameNode = {
      id: sessionEvent.id,
      name: "session",
      kind: "session",
      startedAt: sessionEvent.started_at,
      endedAt: sessionEvent.ended_at!,
      durationMs,
      costUsd: 0,
      tokens: 0,
      pctOfTotal: 0,
      children: [],
      isError: false,
    };
    nodeMap.set(sessionEvent.id, rootNode);
  }

  // First pass: create all nodes
  for (const event of validEvents) {
    const durationMs = (event.ended_at || Date.now()) - event.started_at;
    const costUsd = event.cost_usd || 0;
    const tokens =
      (event.input_tokens || 0) +
      (event.output_tokens || 0) +
      (event.cache_read_tokens || 0) +
      (event.cache_write_tokens || 0);

    totalCostUsd += costUsd;
    totalTokens += tokens;

    let name = event.kind;
    if (event.kind === "turn") {
      let turnIndex: string | number = "?";
      if (event.metadata) {
        try {
          const parsed = JSON.parse(event.metadata);
          turnIndex = parsed?.turnIndex ?? "?";
        } catch {
          turnIndex = "?";
        }
      }
      name = `turn:${turnIndex}`;
    } else if (event.kind === "tool_exec") {
      name = event.tool_name || "unknown_tool";
    } else if (event.kind === "llm_call") {
      name = `llm:${event.model || "unknown"}`;
    } else if (event.kind === "context_build") {
      name = "context_build";
    }

    const node: FlameNode = {
      id: event.id,
      name,
      kind: event.kind,
      startedAt: event.started_at,
      endedAt: event.ended_at || event.started_at,
      durationMs,
      costUsd,
      tokens,
      pctOfTotal: 0, // computed later
      children: [],
      toolName: event.tool_name,
      model: event.model,
      isError: event.is_error ? true : false,
    };

    nodeMap.set(event.id, node);
  }

  // Second pass: link parent-child relationships
  for (const event of validEvents) {
    const node = nodeMap.get(event.id)!;
    if (!node) continue;
    if (event.id === sessionEvent.id && !isRootSynthetic) {
      continue;
    }
    if (event.parent_id) {
      const parent = nodeMap.get(event.parent_id);
      if (parent) {
        parent.children.push(node);
      } else {
        const rootNode = nodeMap.get(sessionEvent.id);
        if (rootNode) {
          rootNode.children.push(node);
        }
      }
    } else {
      const rootNode = nodeMap.get(sessionEvent.id);
      if (rootNode && node.id !== rootNode.id) {
        rootNode.children.push(node);
      }
    }
  }

  // Third pass: compute percentages and detect loops
  const root = nodeMap.get(sessionEvent.id);
  if (!root) return null;
  computePercentages(root, totalCostUsd || 1);
  detectLoops(root);

  return root;
}

/**
 * Recursively compute percentage of total for each node
 */
function computePercentages(node: FlameNode, totalCostUsd: number): void {
  node.pctOfTotal = totalCostUsd > 0 ? (node.costUsd / totalCostUsd) * 100 : 0;
  for (const child of node.children) {
    computePercentages(child, totalCostUsd);
  }
}

/**
 * Detect loops: if a tool is called 3+ times as siblings, mark them
 */
function detectLoops(node: FlameNode): void {
  // Group children by name
  const childrenByName = new Map<string, FlameNode[]>();
  for (const child of node.children) {
    if (!childrenByName.has(child.name)) {
      childrenByName.set(child.name, []);
    }
    childrenByName.get(child.name)!.push(child);
  }

  // Mark loops
  for (const [name, children] of childrenByName) {
    if (children.length >= 3) {
      for (const child of children) {
        child.loopFlag = true;
      }
    }
  }

  // Recurse
  for (const child of node.children) {
    detectLoops(child);
  }
}

/**
 * Compute aggregated metrics for a flame tree
 */
export function computeTreeMetrics(
  root: FlameNode | null,
): { totalCost: number; totalTokens: number; maxDepth: number; nodeCount: number } {
  if (!root) return { totalCost: 0, totalTokens: 0, maxDepth: 0, nodeCount: 0 };

  let maxDepth = 0;
  let nodeCount = 0;
  let totalCost = 0;
  let totalTokens = 0;

  function visit(node: FlameNode, depth: number): void {
    maxDepth = Math.max(maxDepth, depth);
    nodeCount++;
    totalCost += node.costUsd || 0;
    totalTokens += node.tokens || 0;
    for (const child of node.children) {
      visit(child, depth + 1);
    }
  }

  visit(root, 0);

  return {
    totalCost,
    totalTokens,
    maxDepth,
    nodeCount,
  };
}
