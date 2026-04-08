/**
 * API client for flamegraph server
 */
export const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:3000";
async function request(path, options = {}) {
    const url = `${API_URL}${path}`;
    const { token, ...requestInit } = options;
    const response = await fetch(url, {
        method: requestInit.method || "GET",
        headers: {
            "Content-Type": "application/json",
            ...(token && { Authorization: `Bearer ${token}` }),
            ...requestInit.headers,
        },
        body: requestInit.body ? JSON.stringify(requestInit.body) : undefined,
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${response.status} ${error}`);
    }
    return response.json();
}
export const api = {
    getSessions: (workspaceId, limit = 100, offset = 0) => request(`/v1/sessions?workspace_id=${workspaceId}&limit=${limit}&offset=${offset}`),
    getSession: (sessionId) => request(`/v1/sessions/${sessionId}`),
    getFlameGraph: (sessionId) => request(`/v1/sessions/${sessionId}/flamegraph`),
    getCostBreakdown: (workspaceId, groupBy = "tool") => request(`/v1/cost/breakdown?workspace_id=${workspaceId}&group_by=${groupBy}`),
    getHealth: () => request("/health"),
};
//# sourceMappingURL=api.js.map