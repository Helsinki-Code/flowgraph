# Security Rotation Runbook

Last updated: April 9, 2026

## Immediate Actions

1. Rotate all production secrets in provider dashboards:
- `DATABASE_TOKEN`
- `CLERK_SECRET_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Vercel and Render project env secrets
2. Revoke previously generated API keys from the dashboard or database.
3. Redeploy API and web services after rotating secrets.

## Repository Hygiene

1. Confirm no live credentials are present in tracked files:
```bash
npm run secret:scan
```
2. Keep `.env.production` untracked and use `.env.example` as template only.
3. Configure hooks once per clone:
```bash
npm run prepare
```

## Incident Follow-up

1. Audit service logs for unauthorized API key use.
2. Regenerate all customer-facing API keys that were potentially exposed.
3. Record incident timeline and remediation in your internal postmortem.
