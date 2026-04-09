import { test, expect } from '@playwright/test';

test.describe('Event Ingestion', () => {
  test('should ingest events via POST /v1/events', async ({ request }) => {
    // Get API key from environment
    const apiKey = process.env.TEST_API_KEY;
    if (!apiKey) {
      test.skip();
    }

    const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';

    // Create test event payload
    const events = [
      {
        kind: 'session',
        sessionId: `test-session-${Date.now()}`,
        workspaceId: 'test-workspace',
        startedAt: Date.now(),
      },
      {
        kind: 'llm_call',
        eventId: `event-${Date.now()}`,
        sessionId: `test-session-${Date.now()}`,
        parentId: null,
        startedAt: Date.now(),
        endedAt: Date.now() + 100,
        model: 'claude-opus-4-6',
        inputTokens: 150,
        outputTokens: 400,
        costUsd: 0.0167,
      },
    ];

    // POST to /v1/events
    const response = await request.post(`${serverUrl}/v1/events`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      data: events,
    });

    // Should succeed
    expect(response.status()).toBe(200);
  });

  test('should reject events without valid API key', async ({ request }) => {
    const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';

    const events = [
      {
        kind: 'session',
        sessionId: `test-${Date.now()}`,
        workspaceId: 'test',
        startedAt: Date.now(),
      },
    ];

    // POST with invalid key
    const response = await request.post(`${serverUrl}/v1/events`, {
      headers: {
        Authorization: 'Bearer invalid_key',
        'Content-Type': 'application/json',
      },
      data: events,
    });

    // Should reject
    expect(response.status()).toBe(401);
  });
});
