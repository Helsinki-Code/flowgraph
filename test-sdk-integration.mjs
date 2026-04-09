#!/usr/bin/env node
/**
 * End-to-end SDK test: Simulate agent execution and verify events reach dashboard
 * Usage: node test-sdk-integration.mjs
 */

import { LocalCollector } from './packages/sdk/dist/collector.js';

// Configuration
const SERVER_URL = 'https://flowgraph-n8xj.onrender.com';
const API_KEY = 'sk_a1bbbb9c885a1929d57567509eed0d0512d8dfe60e7366f6c9b112a3742c22a9';
const WORKSPACE_ID = 'test-workspace-' + Date.now();
const SESSION_ID = 'session-' + Date.now();

console.log('🔥 Token Flamegraph SDK Integration Test');
console.log('========================================\n');
console.log(`Server: ${SERVER_URL}`);
console.log(`Workspace: ${WORKSPACE_ID}`);
console.log(`Session: ${SESSION_ID}\n`);

// Create collector with server configuration
const collector = new LocalCollector({
  serverUrl: SERVER_URL,
  apiKey: API_KEY,
  autoFlushIntervalMs: 2000, // Auto-flush every 2 seconds
});

async function runTest() {
  try {
    // 1. Start session
    console.log('1️⃣  Starting session...');
    collector.startSession(SESSION_ID, {
      workspaceId: WORKSPACE_ID,
      feature: 'search-agent',
      engineerId: 'test-user',
      projectId: 'test-project',
    });
    console.log('   ✓ Session started\n');

    // 2. Simulate first turn
    console.log('2️⃣  Starting turn 0...');
    collector.startTurn(SESSION_ID, 0);
    console.log('   ✓ Turn started\n');

    // 3. Record LLM call
    console.log('3️⃣  Recording LLM call (Claude 3.5 Sonnet)...');
    collector.recordLlmCall({
      sessionId: SESSION_ID,
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      inputTokens: 250,
      outputTokens: 180,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.0065,
      stopReason: 'end_turn',
      endedAt: Date.now(),
    });
    console.log('   ✓ LLM call recorded: 250 in → 180 out = $0.0065\n');

    // 4. Simulate tool execution
    console.log('4️⃣  Executing tool (search)...');
    const toolStartTime = Date.now();
    collector.startToolExec({
      sessionId: SESSION_ID,
      toolName: 'search',
      toolCallId: 'tool-search-1',
      inputBytes: 512,
      startedAt: toolStartTime,
    });
    console.log('   ✓ Tool execution started\n');

    // Simulate tool work
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('5️⃣  Tool execution completed...');
    collector.endToolExec({
      toolCallId: 'tool-search-1',
      outputBytes: 2048,
      isError: false,
      endedAt: Date.now(),
    });
    console.log('   ✓ Tool execution ended: 512 in → 2048 out\n');

    // 6. Record context build
    console.log('6️⃣  Recording context build...');
    collector.recordContextBuild({
      sessionId: SESSION_ID,
      messageCount: 6,
      estimatedTokens: 450,
      durationMs: 45,
      endedAt: Date.now(),
    });
    console.log('   ✓ Context build recorded: 6 messages, ~450 tokens\n');

    // 7. Simulate second turn with another LLM call
    console.log('7️⃣  Starting turn 1...');
    collector.startTurn(SESSION_ID, 1);
    console.log('   ✓ Turn started\n');

    console.log('8️⃣  Recording second LLM call...');
    collector.recordLlmCall({
      sessionId: SESSION_ID,
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      inputTokens: 600,
      outputTokens: 250,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
      costUsd: 0.0125,
      stopReason: 'end_turn',
      endedAt: Date.now(),
    });
    console.log('   ✓ LLM call recorded: 600 in → 250 out (100 cache reads) = $0.0125\n');

    // 8. Close session
    console.log('9️⃣  Closing session...');
    collector.closeSession(SESSION_ID, Date.now());
    console.log('   ✓ Session closed\n');

    // 9. Flush events to server
    console.log('🔄 Flushing events to server...');
    const events = collector.getEvents();
    console.log(`   Total events collected: ${events.length}`);
    console.log('   Event breakdown:');
    const kinds = {};
    events.forEach(e => {
      kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    });
    Object.entries(kinds).forEach(([kind, count]) => {
      console.log(`     - ${kind}: ${count}`);
    });
    console.log('');

    // Wait for auto-flush (2 seconds)
    console.log('   ⏳ Waiting for auto-flush (2 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 2500));

    console.log('\n✅ Test Complete!');
    console.log('========================================\n');
    console.log('📊 Verification Steps:');
    console.log('1. Go to https://eddieai.online/app (or your deployment URL)');
    console.log('2. Check "Sessions" tab - you should see a new session');
    console.log(`   Look for workspace starting with "test-workspace-"`);
    console.log('3. Session should show:');
    console.log('   - Total Cost: $0.0190');
    console.log('   - Total Tokens: 1,280');
    console.log('   - Feature: search-agent');
    console.log('4. Click on the session to see the flame graph\n');

  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    collector.destroy();
  }
}

runTest();
