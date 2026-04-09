import Fastify from "fastify";
import cors from "@fastify/cors";
import crypto from "crypto";
import { buildFlameTree, computeTreeMetrics } from "./flamegraph/builder.js";
import type { QueryEvent, QuerySession } from "@flamegraph/storage";
import { TursoStore } from "@flamegraph/storage";
import { createClerkAuthMiddleware } from "./middleware/auth.js";

type GroupBy = "tool" | "model" | "feature" | "engineer";

const port = parseInt(process.env.PORT || "3000", 10);
const nodeEnv = process.env.NODE_ENV || "development";
const allowedGroupBy = new Set<GroupBy>(["tool", "model", "feature", "engineer"]);

const eventsRateWindowMs = 60_000;
const eventsRateMax = 120;
const eventsRateState = new Map<string, { count: number; windowStart: number }>();

// Production database backed by Turso
const store = new TursoStore();
const clerkAuthMiddleware = createClerkAuthMiddleware(store);

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
  if (request.url === "/health" || request.url.startsWith("/v1/webhooks/stripe")) {
    return;
  }

  if (request.url.startsWith("/v1/")) {
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

        if (event.kind === "session") {
          touchedSessionIds.add(event.sessionId);
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
        } else {
          touchedSessionIds.add(event.sessionId);
          await store.insertEvent(toQueryEvent(event, workspaceId) as QueryEvent);
        }
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
  return { ok: true };
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
    await store.initialize();
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`[flamegraph] server running on port ${port}`);
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
