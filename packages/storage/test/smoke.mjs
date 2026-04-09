import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const schemaPath = path.resolve("src/schema.ts");
const source = fs.readFileSync(schemaPath, "utf8");
assert.match(source, /CREATE TABLE IF NOT EXISTS workspaces/);
assert.match(source, /CREATE TABLE IF NOT EXISTS sessions/);
assert.match(source, /CREATE TABLE IF NOT EXISTS events/);
assert.match(source, /CREATE TABLE IF NOT EXISTS ingest_requests/);
console.log("PASS: Storage smoke checks");
