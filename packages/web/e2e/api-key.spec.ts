import { test, expect } from '@playwright/test';

test.describe('API Key Generation', () => {
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

  test('should navigate to settings page', async ({ page }) => {
    await page.goto('/app/settings');

    // Should see settings heading
    const settingsHeading = page.locator('h1:has-text("Settings"), h2:has-text("API Keys")');
    await expect(settingsHeading.first()).toBeVisible({ timeout: 5000 });
  });

  test('should generate a new API key', async ({ page }) => {
    await page.goto('/app/settings');

    // Find and click "Generate New API Key" button
    const generateButton = page.locator('button:has-text("Generate New API Key"), button:has-text("Generate Key")').first();
    await expect(generateButton).toBeVisible({ timeout: 5000 });
    await generateButton.click();

    // Should see new API key in a text field or modal
    const apiKeyInput = page.locator('input[type="text"][value^="sk_"], input[readonly]').first();
    await expect(apiKeyInput).toBeVisible({ timeout: 5000 });

    // Get the key value
    const apiKey = await apiKeyInput.inputValue();
    expect(apiKey).toMatch(/^sk_[a-f0-9]{64}$/);
  });

  test('should copy API key to clipboard', async ({ page }) => {
    await page.goto('/app/settings');

    const generateButton = page.locator('button:has-text("Generate New API Key"), button:has-text("Generate Key")').first();
    await generateButton.click();

    // Find copy button
    const copyButton = page.locator('button:has-text("Copy"), button[title*="copy"]').first();
    await expect(copyButton).toBeVisible({ timeout: 5000 });

    // Click copy button
    await copyButton.click();

    // Should show confirmation message
    const confirmMessage = page.locator('text=/copied|success/i');
    await expect(confirmMessage.first()).toBeVisible({ timeout: 3000 });
  });
});
