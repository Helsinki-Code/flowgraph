import type { QueryEvent, QuerySession } from "@flamegraph/storage";

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-3-7-sonnet": 200_000,
  "claude-3-5-sonnet": 200_000,
  "gpt-4o": 128_000,
  "gpt-4.1": 128_000,
  "gpt-4.1-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-3.5-turbo": 16_000,
};

export interface ContextAnatomyEntry {
  eventId: string;
  model: string;
  inputTokens: number;
  maxContextTokens: number;
  remainingContextTokens: number;
  source: "metadata" | "estimated";
  segments: {
    systemPromptTokens: number;
    historyTokens: number;
    toolResultTokens: number;
    currentTurnTokens: number;
  };
}

export interface WastedTokenFinding {
  id: string;
  category: "repeated_prompt" | "orphan_tool_result" | "context_bloat";
  severity: "low" | "medium" | "high";
  description: string;
  wastedTokens: number;
  wastedCostUsd: number;
  evidence: string[];
}

export interface WastedTokenReport {
  findings: WastedTokenFinding[];
  totalWastedTokens: number;
  totalPotentialSavingsUsd: number;
  recommendations: string[];
}

export interface SessionDiffReport {
  baseSessionId: string;
  targetSessionId: string;
  metrics: {
    costUsd: { base: number; target: number; delta: number; deltaPct: number };
    totalTokens: { base: number; target: number; delta: number; deltaPct: number };
    durationMs: { base: number; target: number; delta: number; deltaPct: number };
    turnCount: { base: number; target: number; delta: number; deltaPct: number };
  };
  eventCounts: {
    llmCalls: { base: number; target: number; delta: number };
    toolExecs: { base: number; target: number; delta: number };
    contextBuilds: { base: number; target: number; delta: number };
    errors: { base: number; target: number; delta: number };
  };
  regressions: Array<{
    key: string;
    baseCostUsd: number;
    targetCostUsd: number;
    deltaCostUsd: number;
    baseTokens: number;
    targetTokens: number;
    deltaTokens: number;
  }>;
}

export interface TopologyReport {
  nodes: Array<{
    id: string;
    eventCount: number;
    costUsd: number;
    tokens: number;
    totalDurationMs: number;
    llmCalls: number;
    toolExecs: number;
  }>;
  edges: Array<{
    from: string;
    to: string;
    count: number;
    totalDurationMs: number;
  }>;
  criticalPath: Array<{
    eventId: string;
    kind: string;
    agentId: string;
    durationMs: number;
    startedAt: number;
    endedAt: number;
    costUsd: number;
    tokens: number;
  }>;
  criticalPathDurationMs: number;
}

export function parseEventMetadata(
  event: Pick<QueryEvent, "metadata">,
): Record<string, unknown> | undefined {
  if (!event.metadata) return undefined;
  try {
    const parsed = JSON.parse(event.metadata);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function getEventTokenCount(event: QueryEvent): number {
  return (
    (event.input_tokens || 0) +
    (event.output_tokens || 0) +
    (event.cache_read_tokens || 0) +
    (event.cache_write_tokens || 0)
  );
}

export function extractAgentId(event: QueryEvent): string {
  const metadata = parseEventMetadata(event);
  const candidate =
    metadata?.agentId ||
    metadata?.agent_id ||
    metadata?.agent ||
    metadata?.actor ||
    metadata?.nodeId ||
    event.engineer_id ||
    event.feature ||
    "primary";
  if (typeof candidate === "string" && candidate.trim() !== "") {
    return candidate.trim();
  }
  return "primary";
}

function normalizePromptSignature(event: QueryEvent): string {
  const metadata = parseEventMetadata(event);
  const raw =
    metadata?.promptSignature ||
    metadata?.prompt_signature ||
    metadata?.promptHash ||
    metadata?.prompt_hash ||
    metadata?.prompt ||
    "";
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 256);
  }
  return `${event.model || "unknown"}:${event.input_tokens || 0}:${event.cache_read_tokens || 0}:${event.cache_write_tokens || 0}`;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pctDelta(base: number, target: number): number {
  if (base === 0) return target === 0 ? 0 : 100;
  return ((target - base) / base) * 100;
}

function modelContextLimit(model: string | undefined): number {
  if (!model) return 128_000;
  const lower = model.toLowerCase();
  const direct = MODEL_CONTEXT_LIMITS[lower];
  if (direct) return direct;
  if (lower.includes("claude")) return 200_000;
  if (lower.includes("gpt-4")) return 128_000;
  if (lower.includes("gpt-3.5")) return 16_000;
  return 128_000;
}

function nearestContextBuild(events: QueryEvent[], llmEvent: QueryEvent): QueryEvent | undefined {
  let nearest: QueryEvent | undefined;
  for (const event of events) {
    if (event.kind !== "context_build") continue;
    if ((event.ended_at || event.started_at) > llmEvent.started_at) continue;
    if (llmEvent.parent_id && event.parent_id && llmEvent.parent_id !== event.parent_id) continue;
    if (!nearest || (event.ended_at || event.started_at) > (nearest.ended_at || nearest.started_at)) {
      nearest = event;
    }
  }
  return nearest;
}

export function buildContextAnatomy(events: QueryEvent[]): ContextAnatomyEntry[] {
  const llmCalls = events
    .filter((event) => event.kind === "llm_call")
    .sort((a, b) => a.started_at - b.started_at);
  const result: ContextAnatomyEntry[] = [];

  for (const call of llmCalls) {
    const metadata = parseEventMetadata(call);
    const anatomy = (metadata?.contextAnatomy || metadata?.context_anatomy) as
      | Record<string, unknown>
      | undefined;

    const metadataSystem =
      toNumber(anatomy?.systemPromptTokens) ??
      toNumber(anatomy?.system_tokens) ??
      toNumber(metadata?.systemPromptTokens);
    const metadataHistory =
      toNumber(anatomy?.historyTokens) ??
      toNumber(anatomy?.history_tokens) ??
      toNumber(metadata?.historyTokens);
    const metadataTool =
      toNumber(anatomy?.toolResultTokens) ??
      toNumber(anatomy?.tool_result_tokens) ??
      toNumber(metadata?.toolResultTokens);
    const metadataCurrent =
      toNumber(anatomy?.currentTurnTokens) ??
      toNumber(anatomy?.current_turn_tokens) ??
      toNumber(metadata?.currentTurnTokens);

    const inputTokens = call.input_tokens || 0;
    const maxContextTokens = modelContextLimit(call.model);

    let systemPromptTokens = 0;
    let historyTokens = 0;
    let toolResultTokens = 0;
    let currentTurnTokens = 0;
    let source: "metadata" | "estimated" = "estimated";

    if (
      metadataSystem !== undefined ||
      metadataHistory !== undefined ||
      metadataTool !== undefined ||
      metadataCurrent !== undefined
    ) {
      systemPromptTokens = Math.max(0, metadataSystem || 0);
      historyTokens = Math.max(0, metadataHistory || 0);
      toolResultTokens = Math.max(0, metadataTool || 0);
      currentTurnTokens = Math.max(0, metadataCurrent || 0);
      source = "metadata";
    } else {
      const contextEvent = nearestContextBuild(events, call);
      const contextEstimate = Math.max(
        0,
        contextEvent?.context_token_estimate || inputTokens || 0,
      );
      const basis = contextEstimate > 0 ? contextEstimate : inputTokens;
      systemPromptTokens = Math.round(basis * 0.14);
      historyTokens = Math.round(basis * 0.46);
      toolResultTokens = Math.round(basis * 0.22);
      currentTurnTokens = Math.max(
        0,
        Math.min(inputTokens, basis) - systemPromptTokens - historyTokens - toolResultTokens,
      );
      if (currentTurnTokens === 0 && inputTokens > 0) {
        currentTurnTokens = Math.max(0, Math.round(basis * 0.18));
      }
    }

    const usedContextTokens = Math.max(
      inputTokens,
      systemPromptTokens + historyTokens + toolResultTokens + currentTurnTokens,
    );
    const remainingContextTokens = Math.max(0, maxContextTokens - usedContextTokens);

    result.push({
      eventId: call.id,
      model: call.model || "unknown",
      inputTokens,
      maxContextTokens,
      remainingContextTokens,
      source,
      segments: {
        systemPromptTokens,
        historyTokens,
        toolResultTokens,
        currentTurnTokens,
      },
    });
  }

  return result;
}

export function buildWastedTokenReport(
  session: QuerySession,
  events: QueryEvent[],
): WastedTokenReport {
  const llmCalls = events
    .filter((event) => event.kind === "llm_call")
    .sort((a, b) => a.started_at - b.started_at);
  const toolExecs = events
    .filter((event) => event.kind === "tool_exec")
    .sort((a, b) => a.started_at - b.started_at);
  const contextBuilds = events
    .filter((event) => event.kind === "context_build")
    .sort((a, b) => a.started_at - b.started_at);

  const findings: WastedTokenFinding[] = [];
  const totalLlmTokens = llmCalls.reduce((sum, event) => sum + getEventTokenCount(event), 0);
  const totalLlmCost = llmCalls.reduce((sum, event) => sum + (event.cost_usd || 0), 0);
  const usdPerToken = totalLlmTokens > 0 ? totalLlmCost / totalLlmTokens : 0;

  for (let i = 1; i < llmCalls.length; i++) {
    const previous = llmCalls[i - 1];
    const current = llmCalls[i];
    const previousSignature = normalizePromptSignature(previous);
    const currentSignature = normalizePromptSignature(current);
    const looksRepeated =
      previousSignature === currentSignature ||
      ((previous.model || "unknown") === (current.model || "unknown") &&
        Math.abs((previous.input_tokens || 0) - (current.input_tokens || 0)) <= 8 &&
        Math.abs((previous.output_tokens || 0) - (current.output_tokens || 0)) <= 16 &&
        current.started_at - previous.started_at <= 120_000);

    if (!looksRepeated) continue;

    const wastedTokens = Math.max(0, Math.min(previous.input_tokens || 0, current.input_tokens || 0));
    if (wastedTokens === 0) continue;
    findings.push({
      id: `repeated-${current.id}`,
      category: "repeated_prompt",
      severity: wastedTokens >= 3000 ? "high" : wastedTokens >= 1000 ? "medium" : "low",
      description:
        "Likely repeated prompt/context detected across adjacent LLM calls. This often indicates retries without prompt deduplication.",
      wastedTokens,
      wastedCostUsd: wastedTokens * usdPerToken,
      evidence: [
        `model=${current.model || "unknown"}`,
        `prevEvent=${previous.id}`,
        `event=${current.id}`,
      ],
    });
  }

  for (const toolEvent of toolExecs) {
    const outputBytes = toolEvent.tool_output_bytes || 0;
    if (outputBytes < 1200) continue;
    const endedAt = toolEvent.ended_at || toolEvent.started_at;
    const consumedSoon = llmCalls.some((llm) => {
      if (llm.started_at < endedAt) return false;
      if (llm.started_at - endedAt > 90_000) return false;
      if (toolEvent.parent_id && llm.parent_id && llm.parent_id === toolEvent.parent_id) return true;
      return llm.started_at - endedAt <= 30_000;
    });
    if (consumedSoon) continue;

    const wastedTokens = Math.round(outputBytes / 4);
    findings.push({
      id: `orphan-tool-${toolEvent.id}`,
      category: "orphan_tool_result",
      severity: wastedTokens >= 2000 ? "high" : wastedTokens >= 600 ? "medium" : "low",
      description:
        "Tool output appears to be generated but not consumed by a nearby LLM call. Consider summarizing or truncating tool output.",
      wastedTokens,
      wastedCostUsd: wastedTokens * usdPerToken,
      evidence: [
        `tool=${toolEvent.tool_name || "unknown"}`,
        `outputBytes=${outputBytes}`,
        `event=${toolEvent.id}`,
      ],
    });
  }

  const contextEstimates = contextBuilds
    .map((event) => event.context_token_estimate || 0)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const medianContext =
    contextEstimates.length === 0
      ? 0
      : contextEstimates[Math.floor(contextEstimates.length / 2)];
  const contextThreshold = Math.max(3000, Math.round(medianContext * 1.4));
  for (const contextEvent of contextBuilds) {
    const estimate = contextEvent.context_token_estimate || 0;
    if (estimate <= contextThreshold) continue;
    const baseline = Math.max(2500, Math.round(medianContext * 1.2));
    const wastedTokens = Math.max(0, estimate - baseline);
    if (wastedTokens === 0) continue;
    findings.push({
      id: `context-bloat-${contextEvent.id}`,
      category: "context_bloat",
      severity: wastedTokens >= 4000 ? "high" : wastedTokens >= 1200 ? "medium" : "low",
      description:
        "Context window growth is above typical levels for this session, likely causing avoidable token burn.",
      wastedTokens,
      wastedCostUsd: wastedTokens * usdPerToken,
      evidence: [
        `messages=${contextEvent.context_messages || 0}`,
        `estimate=${estimate}`,
        `median=${medianContext}`,
      ],
    });
  }

  const totalWastedTokens = findings.reduce((sum, finding) => sum + finding.wastedTokens, 0);
  const totalPotentialSavingsUsd = findings.reduce(
    (sum, finding) => sum + finding.wastedCostUsd,
    0,
  );
  const recommendations = new Set<string>();
  if (findings.some((finding) => finding.category === "repeated_prompt")) {
    recommendations.add("Add prompt-signature dedupe before retrying LLM calls.");
  }
  if (findings.some((finding) => finding.category === "orphan_tool_result")) {
    recommendations.add("Trim and summarize tool outputs before inserting into context.");
  }
  if (findings.some((finding) => finding.category === "context_bloat")) {
    recommendations.add("Apply rolling context compaction and token budget caps per turn.");
  }
  if (findings.length === 0 && (session.total_tokens || 0) > 0) {
    recommendations.add("No major waste heuristics triggered in this session.");
  }

  return {
    findings,
    totalWastedTokens,
    totalPotentialSavingsUsd,
    recommendations: [...recommendations],
  };
}

function aggregateEventCounts(events: QueryEvent[]) {
  let llmCalls = 0;
  let toolExecs = 0;
  let contextBuilds = 0;
  let errors = 0;
  const modelCost = new Map<string, { costUsd: number; tokens: number }>();

  for (const event of events) {
    if (event.is_error) errors += 1;
    if (event.kind === "llm_call") {
      llmCalls += 1;
      const key = event.model || "unknown";
      const current = modelCost.get(key) || { costUsd: 0, tokens: 0 };
      current.costUsd += event.cost_usd || 0;
      current.tokens += getEventTokenCount(event);
      modelCost.set(key, current);
    } else if (event.kind === "tool_exec") {
      toolExecs += 1;
    } else if (event.kind === "context_build") {
      contextBuilds += 1;
    }
  }

  return { llmCalls, toolExecs, contextBuilds, errors, modelCost };
}

export function buildSessionDiff(
  baseSession: QuerySession,
  baseEvents: QueryEvent[],
  targetSession: QuerySession,
  targetEvents: QueryEvent[],
): SessionDiffReport {
  const baseDuration = Math.max(0, (baseSession.ended_at || baseSession.started_at) - baseSession.started_at);
  const targetDuration = Math.max(
    0,
    (targetSession.ended_at || targetSession.started_at) - targetSession.started_at,
  );

  const baseAgg = aggregateEventCounts(baseEvents);
  const targetAgg = aggregateEventCounts(targetEvents);

  const metrics = {
    costUsd: {
      base: baseSession.total_cost_usd || 0,
      target: targetSession.total_cost_usd || 0,
      delta: (targetSession.total_cost_usd || 0) - (baseSession.total_cost_usd || 0),
      deltaPct: pctDelta(baseSession.total_cost_usd || 0, targetSession.total_cost_usd || 0),
    },
    totalTokens: {
      base: baseSession.total_tokens || 0,
      target: targetSession.total_tokens || 0,
      delta: (targetSession.total_tokens || 0) - (baseSession.total_tokens || 0),
      deltaPct: pctDelta(baseSession.total_tokens || 0, targetSession.total_tokens || 0),
    },
    durationMs: {
      base: baseDuration,
      target: targetDuration,
      delta: targetDuration - baseDuration,
      deltaPct: pctDelta(baseDuration, targetDuration),
    },
    turnCount: {
      base: baseSession.turn_count || 0,
      target: targetSession.turn_count || 0,
      delta: (targetSession.turn_count || 0) - (baseSession.turn_count || 0),
      deltaPct: pctDelta(baseSession.turn_count || 0, targetSession.turn_count || 0),
    },
  };

  const eventCounts = {
    llmCalls: {
      base: baseAgg.llmCalls,
      target: targetAgg.llmCalls,
      delta: targetAgg.llmCalls - baseAgg.llmCalls,
    },
    toolExecs: {
      base: baseAgg.toolExecs,
      target: targetAgg.toolExecs,
      delta: targetAgg.toolExecs - baseAgg.toolExecs,
    },
    contextBuilds: {
      base: baseAgg.contextBuilds,
      target: targetAgg.contextBuilds,
      delta: targetAgg.contextBuilds - baseAgg.contextBuilds,
    },
    errors: {
      base: baseAgg.errors,
      target: targetAgg.errors,
      delta: targetAgg.errors - baseAgg.errors,
    },
  };

  const keys = new Set<string>([
    ...baseAgg.modelCost.keys(),
    ...targetAgg.modelCost.keys(),
  ]);
  const regressions = [...keys]
    .map((key) => {
      const base = baseAgg.modelCost.get(key) || { costUsd: 0, tokens: 0 };
      const target = targetAgg.modelCost.get(key) || { costUsd: 0, tokens: 0 };
      return {
        key,
        baseCostUsd: base.costUsd,
        targetCostUsd: target.costUsd,
        deltaCostUsd: target.costUsd - base.costUsd,
        baseTokens: base.tokens,
        targetTokens: target.tokens,
        deltaTokens: target.tokens - base.tokens,
      };
    })
    .filter((item) => item.deltaCostUsd > 0 || item.deltaTokens > 0)
    .sort((a, b) => b.deltaCostUsd - a.deltaCostUsd)
    .slice(0, 10);

  return {
    baseSessionId: baseSession.id,
    targetSessionId: targetSession.id,
    metrics,
    eventCounts,
    regressions,
  };
}

export function buildTopology(events: QueryEvent[]): TopologyReport {
  const nodeMap = new Map<
    string,
    {
      id: string;
      eventCount: number;
      costUsd: number;
      tokens: number;
      totalDurationMs: number;
      llmCalls: number;
      toolExecs: number;
    }
  >();
  const edgeMap = new Map<string, { from: string; to: string; count: number; totalDurationMs: number }>();
  const byId = new Map<string, QueryEvent>();
  const children = new Map<string, QueryEvent[]>();

  const sorted = [...events].sort((a, b) => a.started_at - b.started_at);
  for (const event of sorted) {
    byId.set(event.id, event);
    const parentId = event.parent_id || "__root__";
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId)!.push(event);

    const agentId = extractAgentId(event);
    if (!nodeMap.has(agentId)) {
      nodeMap.set(agentId, {
        id: agentId,
        eventCount: 0,
        costUsd: 0,
        tokens: 0,
        totalDurationMs: 0,
        llmCalls: 0,
        toolExecs: 0,
      });
    }
    const node = nodeMap.get(agentId)!;
    node.eventCount += 1;
    node.costUsd += event.cost_usd || 0;
    node.tokens += getEventTokenCount(event);
    node.totalDurationMs += Math.max(0, (event.ended_at || event.started_at) - event.started_at);
    if (event.kind === "llm_call") node.llmCalls += 1;
    if (event.kind === "tool_exec") node.toolExecs += 1;

    if (event.parent_id) {
      const parent = byId.get(event.parent_id);
      if (parent) {
        const parentAgent = extractAgentId(parent);
        const childAgent = agentId;
        if (parentAgent !== childAgent) {
          const key = `${parentAgent}=>${childAgent}`;
          if (!edgeMap.has(key)) {
            edgeMap.set(key, { from: parentAgent, to: childAgent, count: 0, totalDurationMs: 0 });
          }
          const edge = edgeMap.get(key)!;
          edge.count += 1;
          edge.totalDurationMs += Math.max(
            0,
            (event.ended_at || event.started_at) - event.started_at,
          );
        }
      }
    }
  }

  function pathScore(path: QueryEvent[]): number {
    return path.reduce(
      (sum, event) => sum + Math.max(0, (event.ended_at || event.started_at) - event.started_at),
      0,
    );
  }

  function longestPathFrom(event: QueryEvent): QueryEvent[] {
    const directChildren = children.get(event.id) || [];
    if (directChildren.length === 0) return [event];
    let bestChildPath: QueryEvent[] = [];
    for (const child of directChildren) {
      const childPath = longestPathFrom(child);
      if (pathScore(childPath) > pathScore(bestChildPath)) {
        bestChildPath = childPath;
      }
    }
    return [event, ...bestChildPath];
  }

  const roots = children.get("__root__") || [];
  let bestPath: QueryEvent[] = [];
  for (const root of roots) {
    const candidate = longestPathFrom(root);
    if (pathScore(candidate) > pathScore(bestPath)) bestPath = candidate;
  }

  const criticalPath = bestPath.map((event) => ({
    eventId: event.id,
    kind: event.kind,
    agentId: extractAgentId(event),
    durationMs: Math.max(0, (event.ended_at || event.started_at) - event.started_at),
    startedAt: event.started_at,
    endedAt: event.ended_at || event.started_at,
    costUsd: event.cost_usd || 0,
    tokens: getEventTokenCount(event),
  }));

  return {
    nodes: [...nodeMap.values()].sort((a, b) => b.costUsd - a.costUsd),
    edges: [...edgeMap.values()].sort((a, b) => b.totalDurationMs - a.totalDurationMs),
    criticalPath,
    criticalPathDurationMs: pathScore(bestPath),
  };
}
