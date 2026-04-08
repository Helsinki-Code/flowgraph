import { createClerkClient } from "@clerk/backend";
const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY
});
export async function clerkAuthMiddleware(request, reply) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "Missing or invalid authorization header" });
        return;
    }
    const token = authHeader.replace("Bearer ", "");
    try {
        const session = await clerk.sessions.verifyToken(token);
        request.workspaceId = session.claims.org_id || session.userId;
    }
    catch (e) {
        reply.code(401).send({ error: "Invalid token" });
    }
}
//# sourceMappingURL=auth.js.map