import { defineConfig } from "astro/config";
import clerk from "@clerk/astro";
import vercel from "@astrojs/vercel/serverless";

export default defineConfig({
  output: "hybrid",
  adapter: vercel({
    maxDuration: 30,
  }),
  integrations: [
    clerk({
      signInFallbackRedirectUrl: "/app",
      signUpFallbackRedirectUrl: "/app",
    }),
  ],
  vite: {
    define: {
      "process.env.API_URL": JSON.stringify(process.env.API_URL || "http://localhost:3000"),
    },
  },
});
