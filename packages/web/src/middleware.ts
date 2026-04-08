import { clerkMiddleware } from "@clerk/astro/server";

// Make auth available in Astro.locals for all routes
// Route protection is handled in individual pages
export const onRequest = clerkMiddleware({
  // Allow all public routes to pass through
  // /app/* pages will check auth themselves
});
