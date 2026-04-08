/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        slate: {
          950: "#0f172a",
          900: "#0f1419",
          800: "#1e293b",
          700: "#334155",
        },
      },
    },
  },
  plugins: [],
};
