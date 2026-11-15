// =============================================================================
// main.ts — CLI entry point. Given complete.
//   npm start -- "What is 1234 * 5678, and what time is it in Tokyo?"
// =============================================================================
import { runAgent, type TraceEvent } from "./agent.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

function printTrace(e: TraceEvent): void {
  switch (e.type) {
    case "model_call":
      console.log(`\n[step ${e.step}] → model (${e.messageCount} messages)`);
      break;
    case "model_response":
      console.log(`[step ${e.step}] ← finish_reason=${e.finishReason} tool_calls=${e.toolCalls}`);
      if (e.content) console.log(`           text: ${e.content}`);
      break;
    case "tool_call":
      console.log(`[step ${e.step}]   call ${e.name}(${e.rawArgs})`);
      break;
    case "tool_result":
      console.log(`[step ${e.step}]   ${e.ok ? "ok " : "ERR"} ${e.name} → ${e.content}`);
      break;
  }
}

const input = process.argv.slice(2).join(" ").trim();
if (!input) {
  console.error('Usage: npm start -- "your question"');
  process.exit(1);
}

const result = await runAgent(input, {
  apiKey: requireEnv("OPENROUTER_API_KEY"),
  model: requireEnv("MODEL"),
  temperature: 0,
  maxSteps: 8,
  systemPrompt: "You are a precise assistant. Use tools for arithmetic and for the current time.",
  onTrace: printTrace,
});

console.log(`\n=== ${result.stoppedReason} after ${result.steps} step(s) ===\n${result.answer}`);
