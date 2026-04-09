import { verifyToken } from "@clerk/backend";
import crypto from "crypto";
import { TursoStore } from "@flamegraph/storage";

export async function clerkAuthMiddleware(request: any, reply: any) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.replace("Bearer ", "");

  // Check if token is an API key (starts with sk_)
  if (token.startsWith("sk_")) {
    try {
      const keyHash = crypto.createHash("sha256").update(token).digest("hex");
      const store = new TursoStore();
      const workspaceId = await store.validateApiKey(keyHash);

      if (!workspaceId) {
        reply.code(401).send({ error: "Invalid API key" });
        return;
      }

      request.workspaceId = workspaceId;
      request.userId = undefined;
      return;
    } catch (err) {
      console.error("[auth] API key verification error:", err);
      reply.code(401).send({ error: "Invalid API key" });
      return;
    }
  }

  // Otherwise, verify as Clerk token
  try {
    const decoded = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    request.workspaceId = decoded.org_id || decoded.sub;
    request.userId = decoded.sub;
  } catch (err) {
    reply.code(401).send({ error: "Invalid or expired token" });
  }
}
