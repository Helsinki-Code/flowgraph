import Fastify from "fastify";
import cors from "@fastify/cors";
import crypto from "crypto";
import { buildFlameTree, computeTreeMetrics } from "./flamegraph/builder.js";
import type { QueryBudget, QueryEvent, QuerySession } from "@flamegraph/storage";
import { TursoStore } from "@flamegraph/storage";
import { createClerkAuthMiddleware } from "./middleware/auth.js";
import {
  buildContextAnatomy,
  buildSessionDiff,
  buildTopology,
  buildWastedTokenReport,
  extractAgentId,
  getEventTokenCount,
} from "./analytics/session-intelligence.js";

type GroupBy = "tool" | "model" | "feature" | "engineer";

const port = parseInt(process.env.PORT || "3000", 10);
const nodeEnv = process.env.NODE_ENV || "development";
const allowedGroupBy = new Set<GroupBy>(["tool", "model", "feature", "engineer"]);

const eventsRateWindowMs = 60_000;
const eventsRateMax = 120;
const eventsRateState = new Map<string, { count: number; windowStart: number }>();
const storeRetryBaseMs = 1_500;
const storeRetryMaxMs = 30_000;

// Production database backed by Turso
const store = new TursoStore();
const clerkAuthMiddleware = createClerkAuthMiddleware(store);
let storeReady = false;
let storeReconnectInProgress = false;
let storeConnectAttempts = 0;
let storeLastError: string | undefined;

// Create Fastify instance
const app = Fastify({
  logger: nodeEnv !== "test",
  bodyLimit: 1_500_000,
});

function parseCorsOrigins(input?: string): string[] {
  if (!input || input.trim() === "") {
    return ["http://localhost:3000", "http://localhost:3001"];
  }
  return input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function sendError(
  request: any,
  reply: any,
  statusCode: number,
  code: string,
  message: string,
) {
  reply.code(statusCode).send({
    error: {
      code,
      message,
      requestId: request.id,
    },
  });
}

function requireWorkspace(request: any, reply: any): string | undefined {
  const workspaceId = request.workspaceId as string | undefined;
  if (!workspaceId) {
    sendError(request, reply, 401, "AUTH_WORKSPACE_MISSING", "No workspace context");
    return undefined;
  }
  return workspaceId;
}

function requireClerkAuth(request: any, reply: any): boolean {
  if (request.authType !== "clerk") {
    sendError(
      request,
      reply,
      403,
      "AUTH_USER_TOKEN_REQUIRED",
      "This endpoint requires user authentication.",
    );
    return false;
  }
  return true;
}

function checkEventsRateLimit(ip: string): boolean {
  const now = Date.now();
  const current = eventsRateState.get(ip);
  if (!current || now - current.windowStart > eventsRateWindowMs) {
    eventsRateState.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (current.count >= eventsRateMax) return false;
  current.count += 1;
  eventsRateState.set(ip, current);
  return true;
}

function safeTimingEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelay(attempt: number): number {
  const exp = Math.min(6, Math.max(0, attempt - 1));
  const base = storeRetryBaseMs * Math.pow(2, exp);
  const jitter = Math.floor(Math.random() * 700);
  return Math.min(storeRetryMaxMs, base + jitter);
}

async function ensureStoreConnected(): Promise<void> {
  if (storeReady || storeReconnectInProgress) return;
  storeReconnectInProgress = true;
  while (!storeReady) {
    storeConnectAttempts += 1;
    try {
      await store.initialize();
      storeReady = true;
      storeLastError = undefined;
      app.log.info(
        { attempts: storeConnectAttempts },
        "database connection established; API is now fully available",
      );
      break;
    } catch (err: any) {
      storeLastError = err?.message || String(err);
      const delayMs = computeRetryDelay(storeConnectAttempts);
      app.log.error(
        {
          attempt: storeConnectAttempts,
          retryInMs: delayMs,
          error: storeLastError,
        },
        "database initialization failed; retrying",
      );
      await sleep(delayMs);
    }
  }
  storeReconnectInProgress = false;
}

function verifyStripeSignature(
  signatureHeader: string | undefined,
  payload: string,
  secret: string | undefined,
): boolean {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signature = parts.find((part) => part.startsWith("v1="))?.slice(3);
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return safeTimingEqual(signature, expected);
}

function toQueryEvent(event: any, workspaceId: string): QueryEvent {
  return {
    id: event.eventId,
    session_id: event.sessionId,
    parent_id: event.parentId || undefined,
    workspace_id: workspaceId,
    kind: event.kind,
    started_at: event.startedAt,
    ended_at: event.endedAt,
    model: event.model,
    provider: event.provider,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    cache_read_tokens: event.cacheReadTokens,
    cache_write_tokens: event.cacheWriteTokens,
    cost_usd: event.costUsd,
    stop_reason: event.stopReason,
    tool_name: event.toolName,
    tool_call_id: event.toolCallId,
    tool_input_bytes: event.toolInputBytes,
    tool_output_bytes: event.toolOutputBytes,
    is_error: event.isError ? 1 : 0,
    context_messages: event.contextMessages,
    context_token_estimate: event.contextTokenEstimate,
    feature: event.feature,
    pr_number: event.prNumber,
    engineer_id: event.engineerId,
    metadata: event.metadata ? JSON.stringify(event.metadata) : undefined,
  };
}

type BudgetMetric = "cost_usd" | "tokens";
type BudgetScope = "session" | "agent" | "call";

function metricFromEvent(event: any, metric: BudgetMetric): number {
  if (metric === "cost_usd") return Number(event.costUsd || 0);
  const input = Number(event.inputTokens || 0);
  const output = Number(event.outputTokens || 0);
  const cacheRead = Number(event.cacheReadTokens || 0);
  const cacheWrite = Number(event.cacheWriteTokens || 0);
  return input + output + cacheRead + cacheWrite;
}

function parseEventMetadata(raw: any): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function ingestEventAgentId(event: any): string {
  const metadata = parseEventMetadata(event.metadata);
  const candidate =
    metadata.agentId ||
    metadata.agent_id ||
    metadata.agent ||
    metadata.actor ||
    event.projectId ||
    event.engineerId ||
    event.feature ||
    "primary";
  if (typeof candidate === "string" && candidate.trim() !== "") {
    return candidate.trim();
  }
  return "primary";
}

function budgetTargetMatches(budget: QueryBudget, event: any, sessionId: string, agentId: string): boolean {
  if (!budget.target || budget.target.trim() === "") return true;
  if (budget.scope === "session") return budget.target === sessionId;
  if (budget.scope === "agent") return budget.target === agentId;
  if (budget.scope === "call") {
    return budget.target === event.model || budget.target === event.toolName || budget.target === agentId;
  }
  return false;
}

// Register plugins
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
await app.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, corsOrigins.includes(origin));
  },
});

// Register auth + basic rate limiting middleware
app.addHook("preHandler", async (request, reply) => {
  if (request.url === "/health") {
    return;
  }

  if (request.url.startsWith("/v1/") && !storeReady) {
    sendError(
      request,
      reply,
      503,
      "DATABASE_UNAVAILABLE",
      "Database is reconnecting. Please retry shortly.",
    );
    return;
  }

  if (request.url.startsWith("/v1/") && !request.url.startsWith("/v1/webhooks/stripe")) {
    await clerkAuthMiddleware(request, reply);
    if (reply.sent) return;
  }

  if (request.url.startsWith("/v1/events")) {
    const ip = request.ip || request.headers["x-forwarded-for"] || "unknown";
    if (!checkEventsRateLimit(String(ip))) {
      sendError(
        request,
        reply,
        429,
        "RATE_LIMITED",
        "Too many event-ingest requests. Retry in a minute.",
      );
    }
  }
});

/**
 * POST /v1/events
 * Ingest events from SDK with strict tenant isolation + idempotency
 */
app.post<{ Body: any[]; Headers: { "idempotency-key"?: string } }>(
  "/v1/events",
  {
    schema: {
      body: {
        type: "array",
        minItems: 1,
        maxItems: 5000,
        items: {
          type: "object",
          required: ["eventId", "sessionId", "workspaceId", "kind", "startedAt"],
          properties: {
            eventId: { type: "string", minLength: 1, maxLength: 128 },
            sessionId: { type: "string", minLength: 1, maxLength: 128 },
            workspaceId: { type: "string", minLength: 1, maxLength: 128 },
            parentId: { type: ["string", "null"] },
            kind: { type: "string" },
            startedAt: { type: "number" },
            endedAt: { type: "number" },
            metadata: { type: ["object", "null"] },
          },
        },
      },
    },
  },
  async (request, reply) => {
    try {
      if ((request as any).authType !== "api_key") {
        sendError(
          request,
          reply,
          403,
          "AUTH_API_KEY_REQUIRED",
          "Events ingestion requires API key authentication.",
        );
        return;
      }

      const workspaceId = requireWorkspace(request, reply);
      if (!workspaceId) return;

      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey === "string" && idempotencyKey.trim() !== "") {
        const alreadyProcessed = await store.hasIngestRequest(workspaceId, idempotencyKey.trim());
        if (alreadyProcessed) {
          reply.send({ ok: true, deduped: true, count: 0 });
          return;
        }
      }

      const events = request.body || [];
      const touchedSessionIds = new Set<string>();
      const enabledBudgets = await store.listBudgets(workspaceId, true);
      const sessionIncoming = new Map<string, { cost: number; tokens: number }>();
      const agentIncomingBySession = new Map<string, Map<string, { cost: number; tokens: number }>>();

      for (const event of events) {
        if (event.workspaceId !== workspaceId) {
          sendError(
            request,
            reply,
            403,
            "WORKSPACE_MISMATCH",
            "Event workspace does not match authenticated workspace.",
          );
          return;
        }
        if (!event.eventId || !event.sessionId || !Number.isFinite(event.startedAt)) {
          sendError(
            request,
            reply,
            400,
            "INVALID_EVENT",
            "Each event must include eventId, sessionId, and startedAt.",
          );
          return;
        }

        const sessionId = event.sessionId as string;
        touchedSessionIds.add(sessionId);
        if (!sessionIncoming.has(sessionId)) {
          sessionIncoming.set(sessionId, { cost: 0, tokens: 0 });
        }
        const sessionTotals = sessionIncoming.get(sessionId)!;
        sessionTotals.cost += metricFromEvent(event, "cost_usd");
        sessionTotals.tokens += metricFromEvent(event, "tokens");

        if (!agentIncomingBySession.has(sessionId)) {
          agentIncomingBySession.set(sessionId, new Map());
        }
        const incomingByAgent = agentIncomingBySession.get(sessionId)!;
        const agentId = ingestEventAgentId(event);
        if (!incomingByAgent.has(agentId)) {
          incomingByAgent.set(agentId, { cost: 0, tokens: 0 });
        }
        const agentMetrics = incomingByAgent.get(agentId)!;
        agentMetrics.cost += metricFromEvent(event, "cost_usd");
        agentMetrics.tokens += metricFromEvent(event, "tokens");

        if (event.kind === "llm_call") {
          for (const budget of enabledBudgets) {
            if (budget.scope !== "call") continue;
            if (!budgetTargetMatches(budget, event, sessionId, agentId)) continue;
            const currentValue = metricFromEvent(event, budget.metric as BudgetMetric);
            if (currentValue <= budget.limit_value) continue;
            await store.recordBudgetViolation({
              id: crypto.randomUUID(),
              workspace_id: workspaceId,
              budget_id: budget.id,
              session_id: sessionId,
              event_id: event.eventId,
              scope: budget.scope,
              target: budget.target || agentId,
              metric: budget.metric,
              current_value: currentValue,
              limit_value: budget.limit_value,
              action: budget.action,
              details: JSON.stringify({
                reason: "Per-call budget exceeded",
                model: event.model,
              }),
            });
            if (budget.action === "block") {
              sendError(
                request,
                reply,
                402,
                "BUDGET_EXCEEDED",
                `Call budget '${budget.name}' exceeded (${currentValue.toFixed(2)} > ${budget.limit_value}).`,
              );
              return;
            }
          }
        }
      }

      for (const sessionId of touchedSessionIds) {
        const existingSession = await store.getSessionForWorkspace(sessionId, workspaceId);
        const incoming = sessionIncoming.get(sessionId) || { cost: 0, tokens: 0 };
        const projectedCost = (existingSession?.total_cost_usd || 0) + incoming.cost;
        const projectedTokens = (existingSession?.total_tokens || 0) + incoming.tokens;

        for (const budget of enabledBudgets) {
          if (budget.scope !== "session") continue;
          if (budget.target && budget.target !== sessionId) continue;
          const currentValue = budget.metric === "cost_usd" ? projectedCost : projectedTokens;
          if (currentValue <= budget.limit_value) continue;
          await store.recordBudgetViolation({
            id: crypto.randomUUID(),
            workspace_id: workspaceId,
            budget_id: budget.id,
            session_id: sessionId,
            scope: budget.scope,
            target: budget.target || sessionId,
            metric: budget.metric,
            current_value: currentValue,
            limit_value: budget.limit_value,
            action: budget.action,
            details: JSON.stringify({
              reason: "Session budget exceeded",
              projectedCost,
              projectedTokens,
            }),
          });
          if (budget.action === "block") {
            sendError(
              request,
              reply,
              402,
              "BUDGET_EXCEEDED",
              `Session budget '${budget.name}' exceeded for session ${sessionId}.`,
            );
            return;
          }
        }
      }

      for (const sessionId of touchedSessionIds) {
        const existingAgents = await store.getSessionAgentTotals(workspaceId, sessionId);
        const incomingAgents = agentIncomingBySession.get(sessionId) || new Map();
        const mergedAgentIds = new Set<string>([
          ...Object.keys(existingAgents),
          ...incomingAgents.keys(),
        ]);
        for (const agentId of mergedAgentIds) {
          const existing = existingAgents[agentId] || { cost: 0, tokens: 0 };
          const incoming = incomingAgents.get(agentId) || { cost: 0, tokens: 0 };
          const projected = {
            cost: existing.cost + incoming.cost,
            tokens: existing.tokens + incoming.tokens,
          };

          for (const budget of enabledBudgets) {
            if (budget.scope !== "agent") continue;
            if (budget.target && budget.target !== agentId) continue;
            const currentValue = budget.metric === "cost_usd" ? projected.cost : projected.tokens;
            if (currentValue <= budget.limit_value) continue;
            await store.recordBudgetViolation({
              id: crypto.randomUUID(),
              workspace_id: workspaceId,
              budget_id: budget.id,
              session_id: sessionId,
              scope: budget.scope,
              target: budget.target || agentId,
              metric: budget.metric,
              current_value: currentValue,
              limit_value: budget.limit_value,
              action: budget.action,
              details: JSON.stringify({
                reason: "Agent budget exceeded",
                agentId,
              }),
            });
            if (budget.action === "block") {
              sendError(
                request,
                reply,
                402,
                "BUDGET_EXCEEDED",
                `Agent budget '${budget.name}' exceeded for agent ${agentId}.`,
              );
              return;
            }
          }
        }
      }

      for (const event of events) {
        if (event.kind === "session") {
          await store.createWorkspace(workspaceId, "default");
          await store.insertSession({
            id: event.sessionId,
            workspace_id: workspaceId,
            feature: event.feature,
            pr_number: event.prNumber,
            engineer_id: event.engineerId,
            project_id: event.projectId,
            started_at: event.startedAt,
            ended_at: event.endedAt,
            total_cost_usd: 0,
            total_tokens: 0,
            turn_count: 0,
            loop_detected: 0,
          } as QuerySession);
          continue;
        }
        await store.insertEvent(toQueryEvent(event, workspaceId) as QueryEvent);
      }

      for (const sessionId of touchedSessionIds) {
        await store.recomputeSessionTotals(sessionId, workspaceId);
      }

      if (typeof idempotencyKey === "string" && idempotencyKey.trim() !== "") {
        await store.recordIngestRequest(
          crypto.randomUUID(),
          workspaceId,
          idempotencyKey.trim(),
          [...touchedSessionIds][0],
        );
      }

      reply.send({ ok: true, count: events.length });
    } catch (err) {
      app.log.error(err);
      sendError(request, reply, 500, "INGEST_FAILED", "Event ingest failed.");
    }
  },
);

/**
 * GET /v1/sessions
 * List sessions for the authenticated workspace
 */
app.get<{ Querystring: { limit?: string; offset?: string } }>("/v1/sessions", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const limit = Math.min(parsePositiveInt(request.query.limit, 50), 200);
    const offset = Math.max(parsePositiveInt(request.query.offset, 0), 0);
    const sessions = await store.getSessions(workspaceId, limit, offset);
    reply.send({ sessions });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "LIST_SESSIONS_FAILED", "Failed to list sessions.");
  }
});

/**
 * GET /v1/sessions/diff?base_session_id=...&target_session_id=...
 * Compare two sessions and return regressions
 */
app.get<{
  Querystring: { base_session_id?: string; target_session_id?: string };
}>("/v1/sessions/diff", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const baseSessionId = request.query.base_session_id;
    const targetSessionId = request.query.target_session_id;
    if (!baseSessionId || !targetSessionId) {
      sendError(
        request,
        reply,
        400,
        "INVALID_DIFF_REQUEST",
        "base_session_id and target_session_id are required.",
      );
      return;
    }

    const [baseSession, targetSession] = await Promise.all([
      store.getSessionForWorkspace(baseSessionId, workspaceId),
      store.getSessionForWorkspace(targetSessionId, workspaceId),
    ]);
    if (!baseSession || !targetSession) {
      sendError(
        request,
        reply,
        404,
        "SESSION_NOT_FOUND",
        "One or both sessions were not found for this workspace.",
      );
      return;
    }

    const [baseEvents, targetEvents] = await Promise.all([
      store.getSessionEventsForWorkspace(baseSession.id, workspaceId),
      store.getSessionEventsForWorkspace(targetSession.id, workspaceId),
    ]);

    const diff = buildSessionDiff(baseSession, baseEvents, targetSession, targetEvents);
    reply.send({ diff });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "SESSION_DIFF_FAILED", "Failed to compare sessions.");
  }
});

/**
 * GET /v1/sessions/:id
 * Get session detail and events with strict workspace ownership checks
 */
app.get<{ Params: { id: string } }>("/v1/sessions/:id", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { id } = request.params;
    const session = await store.getSessionForWorkspace(id, workspaceId);
    if (!session) {
      sendError(request, reply, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }

    const events = await store.getSessionEventsForWorkspace(id, workspaceId);
    reply.send({ session, events });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "GET_SESSION_FAILED", "Failed to get session.");
  }
});

/**
 * GET /v1/sessions/:id/flamegraph
 */
app.get<{ Params: { id: string } }>("/v1/sessions/:id/flamegraph", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { id } = request.params;
    const session = await store.getSessionForWorkspace(id, workspaceId);
    if (!session) {
      sendError(request, reply, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }

    const events = await store.getSessionEventsForWorkspace(id, workspaceId);
    const tree = buildFlameTree(events);
    const metrics = computeTreeMetrics(tree);
    reply.send({ tree, metrics });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "FLAMEGRAPH_BUILD_FAILED", "Failed to build flamegraph.");
  }
});

/**
 * GET /v1/sessions/:id/context-anatomy
 * Phase 2: Context window anatomy for each LLM call
 */
app.get<{ Params: { id: string } }>("/v1/sessions/:id/context-anatomy", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { id } = request.params;
    const session = await store.getSessionForWorkspace(id, workspaceId);
    if (!session) {
      sendError(request, reply, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }
    const events = await store.getSessionEventsForWorkspace(id, workspaceId);
    const entries = buildContextAnatomy(events);
    reply.send({ sessionId: id, entries });
  } catch (err) {
    app.log.error(err);
    sendError(
      request,
      reply,
      500,
      "CONTEXT_ANATOMY_FAILED",
      "Failed to compute context anatomy.",
    );
  }
});

/**
 * GET /v1/sessions/:id/waste-report
 * Phase 2: Wasted token report
 */
app.get<{ Params: { id: string } }>("/v1/sessions/:id/waste-report", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { id } = request.params;
    const session = await store.getSessionForWorkspace(id, workspaceId);
    if (!session) {
      sendError(request, reply, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }
    const events = await store.getSessionEventsForWorkspace(id, workspaceId);
    const report = buildWastedTokenReport(session, events);
    reply.send({ sessionId: id, report });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "WASTE_REPORT_FAILED", "Failed to generate waste report.");
  }
});

/**
 * GET /v1/sessions/:id/topology
 * Phase 3: Multi-agent topology + critical path
 */
app.get<{ Params: { id: string } }>("/v1/sessions/:id/topology", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { id } = request.params;
    const session = await store.getSessionForWorkspace(id, workspaceId);
    if (!session) {
      sendError(request, reply, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }
    const events = await store.getSessionEventsForWorkspace(id, workspaceId);
    const topology = buildTopology(events);
    reply.send({ sessionId: id, topology });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "TOPOLOGY_FAILED", "Failed to build session topology.");
  }
});

/**
 * GET /v1/sessions/:id/live?cursor=<started_at_ms>&limit=200
 * Phase 3: Incremental live trace feed (poll-based)
 */
app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>(
  "/v1/sessions/:id/live",
  async (request, reply) => {
    try {
      if (!requireClerkAuth(request, reply)) return;
      const workspaceId = requireWorkspace(request, reply);
      if (!workspaceId) return;

      const { id } = request.params;
      const session = await store.getSessionForWorkspace(id, workspaceId);
      if (!session) {
        sendError(request, reply, 404, "SESSION_NOT_FOUND", "Session not found.");
        return;
      }

      const cursor = Math.max(parsePositiveInt(request.query.cursor, 0), 0);
      const limit = Math.min(parsePositiveInt(request.query.limit, 200), 1000);
      const events = await store.getSessionEventsSince(id, workspaceId, cursor, limit);
      const normalized = events.map((event) => ({
        id: event.id,
        parentId: event.parent_id,
        kind: event.kind,
        agentId: extractAgentId(event),
        model: event.model,
        toolName: event.tool_name,
        startedAt: event.started_at,
        endedAt: event.ended_at || event.started_at,
        durationMs: Math.max(0, (event.ended_at || event.started_at) - event.started_at),
        costUsd: event.cost_usd || 0,
        tokens: getEventTokenCount(event),
      }));
      const nextCursor =
        normalized.length > 0
          ? Math.max(...normalized.map((event) => event.startedAt)) + 1
          : cursor;
      reply.send({
        sessionId: id,
        cursor: nextCursor,
        isComplete: Boolean(session.ended_at),
        events: normalized,
      });
    } catch (err) {
      app.log.error(err);
      sendError(request, reply, 500, "LIVE_TRACE_FAILED", "Failed to fetch live trace data.");
    }
  },
);

/**
 * GET /v1/sessions/:id/budget-violations
 */
app.get<{ Params: { id: string } }>("/v1/sessions/:id/budget-violations", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { id } = request.params;
    const session = await store.getSessionForWorkspace(id, workspaceId);
    if (!session) {
      sendError(request, reply, 404, "SESSION_NOT_FOUND", "Session not found.");
      return;
    }
    const violations = await store.listBudgetViolations(workspaceId, id, 100);
    reply.send({ sessionId: id, violations });
  } catch (err) {
    app.log.error(err);
    sendError(
      request,
      reply,
      500,
      "LIST_BUDGET_VIOLATIONS_FAILED",
      "Failed to list budget violations.",
    );
  }
});

/**
 * GET /v1/cost/breakdown
 */
app.get<{ Querystring: { group_by?: string } }>("/v1/cost/breakdown", async (request, reply) => {
  try {
    if (!requireClerkAuth(request, reply)) return;
    const workspaceId = requireWorkspace(request, reply);
    if (!workspaceId) return;

    const groupBy = request.query.group_by as GroupBy | undefined;
    const safeGroupBy: GroupBy = groupBy && allowedGroupBy.has(groupBy) ? groupBy : "tool";
    const breakdown = await store.getCostBreakdown(workspaceId, safeGroupBy);
    reply.send({ breakdown, groupBy: safeGroupBy });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "COST_BREAKDOWN_FAILED", "Failed to compute cost breakdown.");
  }
});

/**
 * Health check
 */
app.get("/health", async () => {
  return {
    ok: true,
    database: {
      ready: storeReady,
      attempts: storeConnectAttempts,
      reconnecting: storeReconnectInProgress,
      lastError: storeLastError,
    },
  };
});

/**
 * Alerts
 */
app.get("/v1/alerts", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const alerts = await store.getAlerts(workspaceId);
    reply.send({ alerts });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "LIST_ALERTS_FAILED", "Failed to list alerts.");
  }
});

app.post("/v1/alerts", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const { name, condition, threshold, webhookUrl, email } = request.body as any;
    if (!name || !condition) {
      sendError(request, reply, 400, "INVALID_ALERT", "Alert name and condition are required.");
      return;
    }

    const id = crypto.randomUUID();
    await store.createAlert(id, workspaceId, name, condition, threshold, webhookUrl, email);
    reply.code(201).send({ id });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "CREATE_ALERT_FAILED", "Failed to create alert.");
  }
});

app.delete("/v1/alerts/:alertId", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const { alertId } = request.params as any;
    const removed = await store.deleteAlert(alertId, workspaceId);
    if (!removed) {
      sendError(request, reply, 404, "ALERT_NOT_FOUND", "Alert not found.");
      return;
    }
    reply.send({ ok: true });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "DELETE_ALERT_FAILED", "Failed to delete alert.");
  }
});

/**
 * Workspace + API key management
 */
app.get("/v1/workspace", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const workspace = await store.getWorkspace(workspaceId);
    const sessions_this_month = await store.getSessionCountForCurrentMonth(workspaceId);
    reply.send({
      workspace: workspace
        ? { ...workspace, sessions_this_month }
        : { id: workspaceId, name: "default", plan: "free", sessions_this_month },
    });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "GET_WORKSPACE_FAILED", "Failed to get workspace.");
  }
});

app.post("/v1/workspace/api-keys", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const apiKey = `sk_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const keyId = crypto.randomUUID();

    await store.createWorkspace(workspaceId, "default");
    await store.createApiKey(workspaceId, keyHash, keyId);
    reply.send({ keyId, apiKey, createdAt: new Date().toISOString() });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "CREATE_API_KEY_FAILED", "Failed to create API key.");
  }
});

app.get("/v1/workspace/api-keys", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const keys = await store.listApiKeys(workspaceId);
    reply.send({
      apiKeys: keys.map((key) => ({
        id: key.id,
        created_at: key.created_at,
        last_used_at: key.last_used_at,
      })),
    });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "LIST_API_KEYS_FAILED", "Failed to list API keys.");
  }
});

app.delete("/v1/workspace/api-keys/:keyId", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const { keyId } = request.params as any;
    const removed = await store.revokeApiKey(workspaceId, keyId);
    if (!removed) {
      sendError(request, reply, 404, "API_KEY_NOT_FOUND", "API key not found.");
      return;
    }
    reply.send({ ok: true });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "REVOKE_API_KEY_FAILED", "Failed to revoke API key.");
  }
});

/**
 * Budget policies (Phase 3)
 */
app.get("/v1/budgets", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const budgets = await store.listBudgets(workspaceId, false);
    reply.send({ budgets });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "LIST_BUDGETS_FAILED", "Failed to list budgets.");
  }
});

app.post("/v1/budgets", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const {
      name,
      scope,
      metric,
      target,
      limitValue,
      action,
      enabled,
    } = request.body as any;

    const safeScope = scope as BudgetScope;
    const safeMetric = metric as BudgetMetric;
    const safeAction = (action as "warn" | "block" | undefined) || "warn";
    const limit = Number(limitValue);
    const scopes = new Set<BudgetScope>(["session", "agent", "call"]);
    const metrics = new Set<BudgetMetric>(["cost_usd", "tokens"]);
    const actions = new Set(["warn", "block"]);

    if (!scopes.has(safeScope) || !metrics.has(safeMetric) || !actions.has(safeAction)) {
      sendError(
        request,
        reply,
        400,
        "INVALID_BUDGET",
        "scope, metric, or action is invalid.",
      );
      return;
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      sendError(request, reply, 400, "INVALID_BUDGET", "limitValue must be a positive number.");
      return;
    }

    const budgetId = crypto.randomUUID();
    await store.createBudget({
      id: budgetId,
      workspace_id: workspaceId,
      name: String(name || `${safeScope} ${safeMetric} limit`),
      scope: safeScope,
      metric: safeMetric,
      target: typeof target === "string" && target.trim() !== "" ? target.trim() : undefined,
      limit_value: limit,
      action: safeAction,
      enabled: enabled === false ? 0 : 1,
    });
    reply.code(201).send({ id: budgetId });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "CREATE_BUDGET_FAILED", "Failed to create budget.");
  }
});

app.delete("/v1/budgets/:budgetId", async (request, reply) => {
  if (!requireClerkAuth(request, reply)) return;
  const workspaceId = requireWorkspace(request, reply);
  if (!workspaceId) return;

  try {
    const { budgetId } = request.params as any;
    const removed = await store.deleteBudget(workspaceId, budgetId);
    if (!removed) {
      sendError(request, reply, 404, "BUDGET_NOT_FOUND", "Budget policy not found.");
      return;
    }
    reply.send({ ok: true });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "DELETE_BUDGET_FAILED", "Failed to delete budget.");
  }
});

/**
 * POST /v1/webhooks/stripe
 * Stripe webhook verification and plan updates
 */
app.post("/v1/webhooks/stripe", async (request, reply) => {
  try {
    const signature = request.headers["stripe-signature"] as string | undefined;
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const payload = JSON.stringify(request.body || {});

    if (!verifyStripeSignature(signature, payload, secret)) {
      sendError(
        request,
        reply,
        400,
        "STRIPE_SIGNATURE_INVALID",
        "Stripe webhook signature verification failed.",
      );
      return;
    }

    const event = request.body as any;
    const customerId = event?.data?.object?.customer as string | undefined;
    const status = event?.data?.object?.status as string | undefined;
    const workspaceId = event?.data?.object?.metadata?.workspaceId as string | undefined;
    if (customerId && workspaceId) {
      const targetPlan: "free" | "pro" | "business" =
        status === "active" && event?.data?.object?.items?.data?.[0]?.price?.unit_amount >= 29900
          ? "business"
          : status === "active"
            ? "pro"
            : "free";
      await store.createWorkspace(workspaceId, "default", targetPlan);
      await store.updateWorkspacePlan(workspaceId, targetPlan, customerId);
    }

    reply.send({ ok: true });
  } catch (err) {
    app.log.error(err);
    sendError(request, reply, 500, "STRIPE_WEBHOOK_FAILED", "Stripe webhook handling failed.");
  }
});

/**
 * Start server
 */
async function start() {
  try {
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`[flamegraph] server running on port ${port}`);
    ensureStoreConnected().catch((err) => {
      app.log.error(err, "database reconnect loop stopped unexpectedly");
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[flamegraph] SIGTERM received, shutting down");
  await app.close();
  process.exit(0);
});

export { app };
