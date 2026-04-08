import { defineConfig } from "astro/config";
import clerk from "@clerk/astro";

export default defineConfig({
  output: "static",
  integrations: [clerk()],
  vite: {
    define: {
      "process.env.API_URL": JSON.stringify(process.env.API_URL || "http://localhost:3000"),
    },
  },
});
