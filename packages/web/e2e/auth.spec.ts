import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('should sign up and sign in', async ({ page }) => {
    // Go to landing page
    await page.goto('/');

    // Click "Get Started" or "Sign Up" button
    const signUpButton = page.locator('a:has-text("Get Started"), a:has-text("Sign Up"), button:has-text("Get Started")').first();
    await signUpButton.click();

    // Should redirect to Clerk sign-in/sign-up page
    await expect(page).toHaveURL(/clerk|accounts/i);
  });

  test('should access dashboard after sign-in', async ({ page, context }) => {
    // Set auth cookie if credentials provided (assumes Clerk token stored)
    // In CI, TEST_CLERK_SESSION should contain valid session cookie
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

    // Navigate to dashboard
    await page.goto('/app');

    // Should see dashboard header or sessions table
    const dashboardHeading = page.locator('h1:has-text("Sessions"), h2:has-text("Dashboard"), [role="table"]');
    await expect(dashboardHeading.first()).toBeVisible({ timeout: 5000 });
  });

  test('should redirect unauthenticated users away from /app', async ({ page }) => {
    await page.goto('/app', { waitUntil: 'networkidle' });

    // Should redirect to sign-in
    const url = page.url();
    expect(url).toMatch(/sign-in|accounts|auth/i);
  });
});
