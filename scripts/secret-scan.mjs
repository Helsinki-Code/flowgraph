#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const includeExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".env",
  ".toml",
  ".astro",
  ".txt",
]);

const skipFragments = [
  "node_modules/",
  ".git/",
  "dist/",
  ".vercel/",
  ".next/",
  ".turbo/",
  "coverage/",
  ".cache/",
];

function shouldSkipEnvFile(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === ".env" || normalized === ".env.local") return true;
  if (/^\.env\..+\.local$/.test(normalized)) return true;
  return false;
}

const patterns = [
  {
    name: "API key (sk_*)",
    regex: /\bsk_[A-Za-z0-9]{24,}\b/g,
    allowlist: ["sk_...", "sk_your_key_here", "sk_test_xxx", "sk_live_xxx"],
  },
  {
    name: "Database token assignment",
    regex: /\bDATABASE_TOKEN\s*=\s*["']?[A-Za-z0-9_\-]{20,}/g,
    allowlist: [],
  },
  {
    name: "Clerk secret assignment",
    regex: /\bCLERK_SECRET_KEY\s*=\s*["']?sk_(?:live|test|proj)_[A-Za-z0-9_\-]{10,}/g,
    allowlist: ["sk_live_xxxx", "sk_test_xxxx"],
  },
  {
    name: "Stripe webhook secret assignment",
    regex: /\bSTRIPE_WEBHOOK_SECRET\s*=\s*["']?whsec_[A-Za-z0-9]{12,}/g,
    allowlist: ["whsec_xxxx"],
  },
];

function isAllowed(match, allowlist) {
  return allowlist.some((sample) => match.includes(sample));
}

function collectCandidateFiles(baseDir, acc = [], relativePrefix = "") {
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(baseDir, entry.name);
    const relativePath = path.join(relativePrefix, entry.name).replace(/\\/g, "/");

    if (skipFragments.some((fragment) => relativePath.includes(fragment.replace(/\\/g, "/")))) {
      continue;
    }

    if (entry.isDirectory()) {
      collectCandidateFiles(absolutePath, acc, relativePath);
      continue;
    }

    if (shouldSkipEnvFile(relativePath)) {
      continue;
    }

    if (includeExtensions.has(path.extname(relativePath)) || relativePath.endsWith(".env")) {
      acc.push(relativePath);
    }
  }

  return acc;
}

function collectTrackedFiles() {
  return collectCandidateFiles(repoRoot);
}

function runScan() {
  const files = collectTrackedFiles();
  const findings = [];

  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath);
    let content = "";
    try {
      content = fs.readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of patterns) {
        const matches = line.match(pattern.regex);
        if (!matches) continue;
        for (const match of matches) {
          if (isAllowed(match, pattern.allowlist)) continue;
          findings.push({
            file: relativePath,
            line: i + 1,
            type: pattern.name,
            value: match.length > 12 ? `${match.slice(0, 6)}...` : match,
          });
        }
      }
    }
  }

  return findings;
}

const findings = runScan();

if (findings.length > 0) {
  console.error("\nSecret scan failed. Potential secrets detected:\n");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.type}] ${finding.value}`);
  }
  console.error(
    "\nIf this is a false positive, replace with a placeholder value before committing.",
  );
  process.exit(1);
}

console.log("Secret scan passed.");
