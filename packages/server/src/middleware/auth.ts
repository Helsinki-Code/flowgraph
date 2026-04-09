import { verifyToken } from "@clerk/backend";
import crypto from "crypto";
import { TursoStore } from "@flamegraph/storage";

function sendAuthError(reply: any, code: string, message: string, requestId?: string) {
  reply.code(401).send({
    error: {
      code,
      message,
      requestId,
    },
  });
}

export function createClerkAuthMiddleware(store: TursoStore) {
  return async function clerkAuthMiddleware(request: any, reply: any) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      sendAuthError(reply, "AUTH_MISSING_BEARER", "Missing or invalid authorization header", request.id);
      return;
    }

    const token = authHeader.replace("Bearer ", "");

    // API key auth for SDK ingestion and service-to-service calls
    if (token.startsWith("sk_")) {
      try {
        const keyHash = crypto.createHash("sha256").update(token).digest("hex");
        const workspaceId = await store.validateApiKey(keyHash);

        if (!workspaceId) {
          sendAuthError(reply, "AUTH_INVALID_API_KEY", "Invalid API key", request.id);
          return;
        }

        request.workspaceId = workspaceId;
        request.userId = undefined;
        request.authType = "api_key";
        return;
      } catch (err) {
        console.error("[auth] API key verification error:", err);
        sendAuthError(reply, "AUTH_INVALID_API_KEY", "Invalid API key", request.id);
        return;
      }
    }

    // Otherwise, verify as Clerk token
    try {
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) {
        sendAuthError(reply, "AUTH_CONFIG_MISSING", "Authentication is not configured", request.id);
        return;
      }

      const decoded = await verifyToken(token, {
        secretKey,
      });
      request.workspaceId = decoded.org_id || decoded.sub;
      request.userId = decoded.sub;
      request.authType = "clerk";
    } catch {
      sendAuthError(reply, "AUTH_INVALID_TOKEN", "Invalid or expired token", request.id);
    }
  };
}
