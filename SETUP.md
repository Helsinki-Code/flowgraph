# Token Flame Graph — Setup Instructions

## Prerequisites

- **Node.js 20+** (verify with `node --version`)
- **npm 10+** (comes with Node.js)

## Installation

```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

## Running Locally

### Option 1: API Server Only

```bash
npm run dev --workspace=packages/server
```

Server runs on `http://localhost:3000`

### Option 2: Web Dashboard Only

```bash
npm run dev --workspace=packages/web
```

Dashboard runs on `http://localhost:3000` with hot-reload

### Option 3: Both (2 terminals)

**Terminal 1 — API Server:**
```bash
npm run dev --workspace=packages/server
```

**Terminal 2 — Web Dashboard:**
```bash
npm run dev --workspace=packages/web
```

Visit `http://localhost:3000` (web) and API is on same port but routes start with `/v1/`

## Build for Production

```bash
npm run build
```

Creates `dist/` in each package:
- `packages/sdk/dist/` — npm-ready package
- `packages/server/dist/` — runnable server
- `packages/web/dist/` — static site + SSR

## Troubleshooting

### "Cannot find module" errors

```bash
npm install --force
```

### Port 3000 in use

Change port:

```bash
# For server
PORT=3001 npm run dev --workspace=packages/server

# For web (Astro)
npm run dev --workspace=packages/web -- --port 3001
```

### TypeScript errors

Make sure `tsconfig.json` in root is correct:

```bash
npx tsc --version  # Should be 5.4.0+
```

### Astro won't start

```bash
cd packages/web
npm install
npm run dev
```

## Architecture Overview

```
token-flamegraph/
├── packages/sdk/       ← Drop-in instrumentation (size: ~10KB)
├── packages/storage/   ← Database schema definitions
├── packages/server/    ← Fastify API on Node.js
└── packages/web/       ← Astro static + SSR dashboard
```

## Commands Reference

| Command | What it does |
|---------|---|
| `npm install` | Install all dependencies |
| `npm run build` | Build all packages |
| `npm run dev --workspace=packages/server` | Run API server with hot-reload |
| `npm run dev --workspace=packages/web` | Run web dashboard with hot-reload |
| `npm test --workspace=packages/sdk` | Run SDK unit tests |

## Next Steps

1. **Test locally:**
   ```bash
   npm install
   npm run dev --workspace=packages/server &
   npm run dev --workspace=packages/web
   ```

2. **Read integration example:**
   - See `EXAMPLE.md` for how to use the SDK with pi-agent

3. **Deploy:**
   - See `DEPLOYMENT.md` for production setup

---

**Need help?** Check [README.md](./README.md) or [QUICKSTART.md](./QUICKSTART.md)
