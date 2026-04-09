import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const collectorPath = path.resolve("src/collector.ts");
const source = fs.readFileSync(collectorPath, "utf8");
assert.match(source, /export class LocalCollector/);
assert.match(source, /startSession\(/);
assert.match(source, /recordLlmCall\(/);
console.log("PASS: SDK smoke checks");
