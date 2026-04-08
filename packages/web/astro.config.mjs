import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel/serverless";
import clerk from "@clerk/astro";

export default defineConfig({
  output: "hybrid",
  adapter: vercel(),
  integrations: [clerk()],
  vite: {
    define: {
      "process.env.API_URL": JSON.stringify(process.env.API_URL || "http://localhost:3000"),
    },
  },
});
