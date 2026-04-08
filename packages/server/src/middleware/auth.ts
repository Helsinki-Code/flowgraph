import { verifyToken } from "@clerk/backend";

export async function clerkAuthMiddleware(request: any, reply: any) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.replace("Bearer ", "");

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
