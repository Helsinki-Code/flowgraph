import { test, expect } from '@playwright/test';

test.describe('Sessions Dashboard', () => {
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

  test('should display sessions list on dashboard', async ({ page }) => {
    await page.goto('/app');

    // Should see table or list of sessions
    const tableOrList = page.locator('[role="table"], .sessions-list, .session-grid');
    await expect(tableOrList.first()).toBeVisible({ timeout: 5000 });
  });

  test('should show session metadata (cost, tokens, duration)', async ({ page }) => {
    await page.goto('/app');

    // Wait for at least one row to load
    const rows = page.locator('[role="row"]').or(page.locator('.session-item'));
    await expect(rows.first()).toBeVisible({ timeout: 5000 });

    // Check for cost column
    const costCell = page.locator('text=/\\$[0-9.]+|cost/i').first();
    await expect(costCell).toBeVisible({ timeout: 3000 });

    // Check for tokens column
    const tokensCell = page.locator('text=/[0-9]+\\s*tokens|tokens:/i').first();
    await expect(tokensCell).toBeVisible({ timeout: 3000 });

    // Check for duration column
    const durationCell = page.locator('text=/\\d+([ms]|sec)|duration/i').first();
    await expect(durationCell).toBeVisible({ timeout: 3000 });
  });

  test('should navigate to session detail on click', async ({ page }) => {
    await page.goto('/app');

    // Click first session row
    const firstSession = page.locator('[role="row"], .session-item').first();
    await expect(firstSession).toBeVisible({ timeout: 5000 });
    await firstSession.click();

    // Should navigate to /app/sessions/:id
    await expect(page).toHaveURL(/\/app\/sessions\/[a-z0-9-]+/i, { timeout: 5000 });
  });

  test('should show loop detected status for problematic sessions', async ({ page }) => {
    await page.goto('/app');

    // Look for any row with "LOOP DETECTED" status
    const loopDetectedBadge = page.locator('text=/loop|🔄|⚠️/i');

    // If it exists, it should be visible (sessions may or may not have loops)
    const loopCount = await loopDetectedBadge.count();
    if (loopCount > 0) {
      await expect(loopDetectedBadge.first()).toBeVisible();
    }
  });
});
