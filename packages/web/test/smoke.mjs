import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const indexPage = fs.readFileSync(path.resolve("src/pages/index.astro"), "utf8");
assert.doesNotMatch(indexPage, /event\.target\.classList\.add/);
assert.doesNotMatch(indexPage, /Used by AI engineers at:/);

const pricingPage = fs.readFileSync(path.resolve("src/pages/pricing.astro"), "utf8");
assert.doesNotMatch(pricingPage, /event\.target\.classList\.add/);

const publicLayout = fs.readFileSync(path.resolve("src/layouts/Public.astro"), "utf8");
assert.match(publicLayout, /href="\/privacy"/);
assert.match(publicLayout, /href="\/terms"/);
assert.match(publicLayout, /href="\/contact"/);
console.log("PASS: Web smoke checks");
