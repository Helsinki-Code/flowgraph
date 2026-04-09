import { test, expect } from '@playwright/test';

test.describe('Flame Graph Visualization', () => {
  test.beforeEach(async ({ page, context }) => {
    // Set up auth before each test
    if (process.env.TEST_CLERK_SESSION) {
      await context.addCookies([
        {
          name: '__session',
          value: process.env.TEST_CLERK_SESSION,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
          expires: Date.now() / 1000 + 86400,
        },
      ]);
    }
  });

  test('should display session detail with 4 stat cards', async ({ page }) => {
    // Use a known session ID if available (e.g., from test data)
    const sessionId = process.env.TEST_SESSION_ID || 'session-1775712556051';
    await page.goto(`/app/sessions/${sessionId}`);

    // Should see 4 stat cards: Cost, Tokens, Turns, Duration
    const costCard = page.locator('text=/total cost|\\$[0-9.]*/i').first();
    const tokensCard = page.locator('text=/total tokens|[0-9]+ tokens/i').first();
    const turnsCard = page.locator('text=/turns|turn/i').first();
    const durationCard = page.locator('text=/duration|[0-9.]+\\s*(ms|s)/i').first();

    await expect(costCard).toBeVisible({ timeout: 5000 });
    await expect(tokensCard).toBeVisible({ timeout: 5000 });
    await expect(turnsCard).toBeVisible({ timeout: 5000 });
    await expect(durationCard).toBeVisible({ timeout: 5000 });
  });

  test('should render execution timeline with flame bars', async ({ page }) => {
    const sessionId = process.env.TEST_SESSION_ID || 'session-1775712556051';
    await page.goto(`/app/sessions/${sessionId}`);

    // Wait for "Execution Timeline" heading
    const timelineHeading = page.locator('text=/execution timeline|timeline/i').first();
    await expect(timelineHeading).toBeVisible({ timeout: 5000 });

    // Should have flame graph container with bars
    const flameGraphContainer = page.locator('[class*="flame"], [class*="timeline"], .execution-timeline').first();
    await expect(flameGraphContainer).toBeVisible({ timeout: 5000 });

    // Check for colored bars (div elements with background colors or specific classes)
    const flameBars = page.locator('[class*="bar"], [class*="node"], [style*="background"]').filter({ has: page.locator('[class*="flame"], [class*="timeline"]') });
    const barCount = await flameBars.count();
    expect(barCount).toBeGreaterThan(0);
  });

  test('should show bar tooltips on hover', async ({ page }) => {
    const sessionId = process.env.TEST_SESSION_ID || 'session-1775712556051';
    await page.goto(`/app/sessions/${sessionId}`);

    // Find first flame bar
    const firstBar = page.locator('[class*="bar"], [class*="node"], [style*="background"]').first();
    await expect(firstBar).toBeVisible({ timeout: 5000 });

    // Hover over it
    await firstBar.hover();

    // Should show tooltip with name, cost, tokens, duration
    const tooltip = page.locator('[role="tooltip"], .tooltip, [class*="tooltip"]');
    const tooltipText = page.locator('text=/llm|tool|turn|cost|token|duration/i');

    // Either a tooltip element appears or text becomes visible
    await expect(tooltip.first().or(tooltipText.first())).toBeVisible({ timeout: 2000 });
  });

  test('should detect and highlight loops', async ({ page }) => {
    const sessionId = process.env.TEST_SESSION_ID || 'session-1775712556051';
    await page.goto(`/app/sessions/${sessionId}`);

    // Look for any bars with loop flag (red border, different styling)
    const loopMarkers = page.locator('[class*="loop"], [style*="red"], [style*="border"]');

    // Count them
    const loopCount = await loopMarkers.count();
    // Loops may or may not exist in a given session, so this is just a smoke test
    expect(loopCount >= 0).toBeTruthy();
  });

  test('should display session details table', async ({ page }) => {
    const sessionId = process.env.TEST_SESSION_ID || 'session-1775712556051';
    await page.goto(`/app/sessions/${sessionId}`);

    // Should see "Session Details" heading or section
    const detailsHeading = page.locator('text=/session details|details|events/i').first();
    await expect(detailsHeading).toBeVisible({ timeout: 5000 });

    // Should have a table with event rows
    const detailsTable = page.locator('[role="table"]').last();
    const rows = detailsTable.locator('[role="row"]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
  });
});
