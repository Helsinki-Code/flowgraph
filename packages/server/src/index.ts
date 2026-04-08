import Fastify from "fastify";
import cors from "@fastify/cors";
import crypto from "crypto";
import { buildFlameTree, computeTreeMetrics } from "./flamegraph/builder.js";
import type { QueryEvent, QuerySession } from "@flamegraph/storage";
import { TursoStore } from "@flamegraph/storage";
import { clerkAuthMiddleware } from "./middleware/auth.js";

const port = parseInt(process.env.PORT || "3000");
const nodeEnv = process.env.NODE_ENV || "development";

// Production database backed by Turso
const store = new TursoStore();

// Create Fastify instance
const app = Fastify({
  logger: nodeEnv !== "test",
});

// Register plugins
await app.register(cors, {
  origin: process.env.CORS_ORIGIN || ["http://localhost:3000", "http://localhost:3001"],
});

// Register auth middleware
app.addHook("preHandler", async (request, reply) => {
  // Skip auth for health check and Stripe webhook
  if (request.url === "/health" || request.url.startsWith("/v1/webhooks/stripe")) {
    return;
  }

  // Require auth on all /v1/* routes
  if (request.url.startsWith("/v1/")) {
    await clerkAuthMiddleware(request, reply);
  }
});

/**
 * POST /v1/events
 * Ingest events from the SDK
 * Body: array of FlamegraphEvent
 */
app.post<{ Body: any[] }>("/v1/events", async (request, reply) => {
  try {
    const events = request.body || [];
    let sessionId: string | null = null;

    // Store events in Turso
    for (const event of events) {
      if (event.kind === "session") {
        sessionId = event.sessionId;
        await store.createWorkspace(event.workspaceId, "default");
        await store.insertSession({
          id: event.sessionId,
          workspace_id: event.workspaceId,
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
        await store.insertEvent({
          id: event.eventId,
          session_id: event.sessionId,
          parent_id: event.parentId,
          workspace_id: event.workspaceId,
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
        } as QueryEvent);
      }
    }

    // Compute and update session totals
    if (sessionId) {
      const totalCostUsd = events.reduce((sum, e) => sum + (e.costUsd || 0), 0);
      const totalTokens = events.reduce(
        (sum, e) => sum + (e.inputTokens || 0) + (e.outputTokens || 0),
        0,
      );
      const turnCount = new Set(events.map((e) => e.metadata?.turnIndex)).size - 1; // -1 for undefined

      // Detect loops
      const loopedTools = await store.detectLoops(sessionId);
      const loopDetected = loopedTools.length > 0 ? 1 : 0;

      await store.updateSessionTotals(sessionId, totalCostUsd, totalTokens, turnCount, loopDetected as 0 | 1);
    }

    app.log.info(`received ${events.length} events`);

    return { ok: true, count: events.length };
  } catch (err) {
    app.log.error(err);
    reply.code(500);
    return { error: "ingest failed" };
  }
});

/**
 * GET /v1/sessions
 * List sessions for workspace with cost/token totals
 */
app.get<{ Querystring: { workspace_id?: string; limit?: string; offset?: string } }>(
  "/v1/sessions",
  async (request, reply) => {
    try {
      const workspaceId = request.query.workspace_id || "default";
      const limit = parseInt(request.query.limit || "100");
      const offset = parseInt(request.query.offset || "0");

      const sessions = await store.getSessions(workspaceId, limit, offset);

      return { sessions };
    } catch (err) {
      app.log.error(err);
      reply.code(500);
      return { error: "failed to list sessions" };
    }
  },
);

/**
 * GET /v1/sessions/:id
 * Get session detail with all events
 */
app.get<{ Params: { id: string } }>("/v1/sessions/:id", async (request, reply) => {
  try {
    const { id } = request.params;
    const session = await store.getSession(id);

    if (!session) {
      reply.code(404);
      return { error: "session not found" };
    }

    const events = await store.getSessionEvents(id);

    return { session, events };
  } catch (err) {
    app.log.error(err);
    reply.code(500);
    return { error: "failed to get session" };
  }
});

/**
 * GET /v1/sessions/:id/flamegraph
 * Get flame tree structure for D3 visualization
 */
app.get<{ Params: { id: string } }>("/v1/sessions/:id/flamegraph", async (request, reply) => {
  try {
    const { id } = request.params;
    const events = await store.getSessionEvents(id);

    if (events.length === 0) {
      reply.code(404);
      return { error: "no events found" };
    }

    const tree = buildFlameTree(events);
    const metrics = computeTreeMetrics(tree);

    return { tree, metrics };
  } catch (err) {
    app.log.error(err);
    reply.code(500);
    return { error: "failed to build flamegraph" };
  }
});

/**
 * GET /v1/cost/breakdown
 * Cost attribution by tool, model, feature, or engineer
 */
app.get<{ Querystring: { workspace_id?: string; group_by?: string } }>(
  "/v1/cost/breakdown",
  async (request, reply) => {
    try {
      const workspaceId = request.query.workspace_id || "default";
      const groupBy = (request.query.group_by as "tool" | "model" | "feature" | "engineer") || "tool";

      const breakdown = await store.getCostBreakdown(workspaceId, groupBy);

      return { breakdown, groupBy };
    } catch (err) {
      app.log.error(err);
      reply.code(500);
      return { error: "failed to compute breakdown" };
    }
  },
);

/**
 * Health check
 */
app.get("/health", async (request, reply) => {
  return { ok: true };
});

/**
 * GET /v1/alerts
 * List alerts for workspace
 */
app.get("/v1/alerts", async (request, reply) => {
  const workspaceId = (request as any).workspaceId || "default";
  const alerts = await store.getAlerts(workspaceId);
  reply.send({ alerts });
});

/**
 * POST /v1/alerts
 * Create a new alert
 */
app.post("/v1/alerts", async (request, reply) => {
  const { name, condition, threshold, webhookUrl, email } = request.body as any;
  const id = crypto.randomUUID();
  const workspaceId = (request as any).workspaceId || "default";
  await store.createAlert(id, workspaceId, name, condition, threshold, webhookUrl, email);
  reply.code(201).send({ id });
});

/**
 * DELETE /v1/alerts/:alertId
 * Delete an alert
 */
app.delete("/v1/alerts/:alertId", async (request, reply) => {
  const { alertId } = request.params as any;
  await store.deleteAlert(alertId);
  reply.send({ ok: true });
});

/**
 * GET /v1/workspace
 * Get workspace details
 */
app.get("/v1/workspace", async (request, reply) => {
  const workspaceId = (request as any).workspaceId;
  if (!workspaceId) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  const workspace = await store.getWorkspace(workspaceId);
  reply.send({ workspace });
});

/**
 * POST /v1/workspace/api-keys
 * Generate a new API key
 */
app.post("/v1/workspace/api-keys", async (request, reply) => {
  const apiKey = `sk_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const workspaceId = (request as any).workspaceId;

  if (!workspaceId) {
    reply.code(401).send({ error: "No workspace context" });
    return;
  }

  try {
    await store.createApiKey(workspaceId, keyHash);
    reply.send({ apiKey, createdAt: new Date().toISOString() });
  } catch (err) {
    console.error("[api-keys] Error creating key:", err);
    reply.code(500).send({ error: "Failed to create API key" });
  }
});

/**
 * POST /v1/webhooks/stripe
 * Stripe webhook for subscription events
 */
app.post("/v1/webhooks/stripe", async (request, reply) => {
  // TODO: verify signature with process.env.STRIPE_WEBHOOK_SECRET
  // TODO: handle customer.subscription.* and invoice.paid events
  reply.send({ ok: true });
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
