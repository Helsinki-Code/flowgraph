import { clerkMiddleware, createRouteMatcher } from "@clerk/astro/server";

const isProtected = createRouteMatcher(["/app(.*)"]);

export const onRequest = clerkMiddleware((auth, context) => {
  if (isProtected(context.request) && !auth().userId) {
    return auth().redirectToSignIn();
  }
});
