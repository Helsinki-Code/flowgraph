# Deployment Guide

## Overview

Token Flame Graph is a full-stack SaaS with three components:
- **API Server** â€” Fastify, handles event ingestion and queries
- **Web Dashboard** â€” Astro, SSR dashboard
- **SDK** â€” npm package, deployed to npm registry

## Prerequisites

- Node.js 20+
- PostgreSQL (production)
- Stripe account (for billing)
- Clerk account (for auth)
- Vercel or Railway account (for hosting)

## Step 1: Prepare for Production

### Update Environment Variables

Copy `.env.example` to `.env.production`:

```bash
cp .env.example .env.production
```

Configure production values:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://user:password@db.example.com:5432/flamegraph

# Clerk authentication
CLERK_SECRET_KEY=sk_live_xxxx
CLERK_PUBLISHABLE_KEY=pk_live_xxxx

# Stripe billing
STRIPE_SECRET_KEY=sk_live_xxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxx

# API
PUBLIC_API_URL=https://api.flamegraph.dev

# CORS
CORS_ORIGIN=https://flamegraph.dev,https://app.flamegraph.dev
```

### Set Up PostgreSQL

1. Create a hosted PostgreSQL database (Railway, Vercel Postgres, AWS RDS, etc.)
2. Run migrations:
   ```bash
   # Use the schema from packages/storage/src/schema.ts
   # Copy each CREATE TABLE statement and run it
   ```
3. Verify connection:
   ```bash
   psql $DATABASE_URL -c "SELECT version();"
   ```

## Step 2: Deploy the API Server

### Option A: Railway

1. Create a new Railway project
2. Add PostgreSQL service
3. Connect GitHub repo
4. Configure environment variables in Railway dashboard
5. Deploy

Railway will automatically:
- Install dependencies
- Run `npm run build`
- Start with `node dist/index.js`

### Option B: Fly.io

1. Install `flyctl`
2. Create a `fly.toml`:
   ```toml
   app = "flamegraph-api"
   
   [env]
     NODE_ENV = "production"
   
   [build]
     builder = "heroku/buildpacks:20"
   
   [[services]]
     internal_port = 3000
     protocol = "tcp"
   ```
3. Set secrets:
   ```bash
   fly secrets set DATABASE_URL=postgres://...
   fly secrets set CLERK_SECRET_KEY=sk_live_...
   ```
4. Deploy:
   ```bash
   fly deploy
   ```

### Option C: Docker

Create a `Dockerfile` for the server:

```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install --production

COPY packages/server/dist ./packages/server/dist
COPY packages/storage/dist ./packages/storage/dist
COPY packages/sdk/dist ./packages/sdk/dist

EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
```

Build and push:

```bash
docker build -t flamegraph:latest .
docker push your-registry/flamegraph:latest
```

## Step 3: Deploy the Web Dashboard

### Option A: Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Deploy from project root:
   ```bash
   cd packages/web
   vercel --prod
   ```
3. Configure environment in Vercel dashboard:
   ```
   PUBLIC_API_URL=https://api.flamegraph.dev
   ```

Vercel will automatically:
- Run `npm run build` (Astro)
- Serve optimized output
- Handle SSL/TLS

### Option B: Netlify

Create `netlify.toml` in `packages/web`:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[env.production]
  PUBLIC_API_URL = "https://api.flamegraph.dev"
```

Deploy:

```bash
cd packages/web
netlify deploy --prod
```

### Option C: Self-Hosted (Node.js)

The Astro output supports server-side rendering. Deploy as Node.js app:

```bash
# Build
npm run build --workspace=packages/web

# Start
NODE_ENV=production node ./packages/web/dist/server/entry.mjs
```

## Step 4: Publish SDK to npm

1. Create npm account at `npmjs.com`
2. Create `.npmrc` in project root:
   ```
   //registry.npmjs.org/:_authToken=npm_xxxxx
   ```
3. Update version in `packages/sdk/package.json`
4. Publish:
   ```bash
   npm publish --workspace=packages/sdk
   ```

The package will be available as `flamegraph-sdk` on npm.

## Step 5: Set Up Stripe (Optional)

### Create Products

1. Go to Stripe Dashboard â†’ Products
2. Create products:
   - **Pro** â€” $49/month
   - **Business** â€” $299/month
3. Copy price IDs to your environment:
   ```env
   STRIPE_PRO_PRICE_ID=price_xxx
   STRIPE_BUSINESS_PRICE_ID=price_xxx
   ```

### Set Up Webhooks

1. Endpoint URL: `https://api.flamegraph.dev/v1/webhooks/stripe`
2. Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
3. Copy webhook secret to `.env.production`:
   ```env
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

## Step 6: Set Up Clerk (Optional)

### Create Application

1. Go to Clerk Dashboard â†’ Applications
2. Create a new application
3. Copy keys:
   ```env
   CLERK_SECRET_KEY=sk_live_xxx
   CLERK_PUBLISHABLE_KEY=pk_live_xxx
   ```

### Configure Allowed Origins

Add your deployed URLs to Clerk:
- `https://flamegraph.dev`
- `https://app.flamegraph.dev`
- `http://localhost:3000` (dev)

## Step 7: Set Up Domain & SSL

### Domain Registration

1. Register domain (GoDaddy, Namecheap, AWS Route53)
2. Update nameservers to your hosting provider

### SSL Certificate

Most providers (Vercel, Railway, Netlify) provide automatic SSL. For self-hosted:

```bash
# Using Let's Encrypt with Certbot
sudo certbot certonly --standalone -d flamegraph.dev -d api.flamegraph.dev
```

Update Fastify to use SSL:

```typescript
const app = await fastify({
  https: {
    key: fs.readFileSync('/etc/letsencrypt/live/api.flamegraph.dev/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/api.flamegraph.dev/fullchain.pem'),
  },
});
```

## Step 8: Monitoring & Logs

### Sentry (Error Tracking)

```bash
npm install @sentry/node
```

In `packages/server/src/index.ts`:

```typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});
```

### Datadog (Metrics & Logs)

```bash
npm install dd-trace
```

## Step 9: CI/CD

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build

  deploy-api:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: rails/workato@v2
        with:
          deployment-key: ${{ secrets.RAILWAY_API_TOKEN }}

  deploy-web:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: vercel/action@master
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

## Troubleshooting

### Server won't start
- Check logs: `fly logs` or `railway logs`
- Verify DATABASE_URL is set and database is reachable
- Run migrations manually

### API calls fail with CORS errors
- Check CORS_ORIGIN matches your domain
- Restart server after environment variable changes

### Web dashboard can't reach API
- Check PUBLIC_API_URL is correct
- Verify API server is running and accessible
- Check browser console for errors

### Database connection errors
- Verify DATABASE_URL is correct
- Check database credentials
- Ensure firewall allows connections from app server

## Scaling

As you grow:

1. **Database** â€” Switch from SQLite to PostgreSQL (done in this guide)
2. **Caching** â€” Add Redis for session cache
3. **File Storage** â€” Move event export to S3/GCS
4. **Workers** â€” Use Bull/BullMQ for async jobs (alerts, exports)
5. **CDN** â€” Put Vercel/Cloudflare in front of API

---

Questions? Check the [main README](./README.md) or open an issue.

