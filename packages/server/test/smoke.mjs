import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const indexPath = path.resolve("src/index.ts");
const source = fs.readFileSync(indexPath, "utf8");
assert.match(source, /AUTH_API_KEY_REQUIRED/);
assert.match(source, /idempotency-key/);
assert.match(source, /getSessionForWorkspace/);
assert.match(source, /recordIngestRequest/);
assert.match(source, /\/v1\/sessions\/:id\/waste-report/);
assert.match(source, /\/v1\/sessions\/:id\/topology/);
assert.match(source, /\/v1\/budgets/);
console.log("PASS: Server smoke checks");
