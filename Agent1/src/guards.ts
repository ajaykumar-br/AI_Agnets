// =============================================================================
// guards.ts — Invariants the loop must never violate, checked in our own code
// rather than trusting the provider to reject bad requests.
// =============================================================================
import type { Message, ToolCall } from "./types.js";

export class HistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryError";
  }
}

/**
 * Rules:
 *  1. Every tool message answers a tool call from the most recent assistant message.
 *  2. Each tool call is answered exactly once.
 *  3. All tool calls are answered before anything else comes next.
 * Throws HistoryError on the first violation. Call it before every model request.
 */
export function validateHistory(messages: Message[]): void {
  const pending = new Set<string>(); // ids requested but not yet answered

  messages.forEach((msg, i) => {
    if (msg.role === "tool") {
      if (!pending.has(msg.tool_call_id)) {
        throw new HistoryError(
          `message[${i}]: tool result for "${msg.tool_call_id}" has no matching pending tool call ` +
            `(was the assistant message appended? is this result a duplicate?)`,
        );
      }
      pending.delete(msg.tool_call_id);
      return;
    }

    // Any non-tool message: all previous calls must already be answered.
    if (pending.size > 0) {
      throw new HistoryError(
        `message[${i}] (${msg.role}): tool calls [${[...pending].join(", ")}] were never answered`,
      );
    }

    if (msg.role === "assistant") {
      for (const call of msg.tool_calls ?? []) {
        pending.add(call.id);
        // console.log(`${[...pending].join(", ")}`);
      }
    }
  });

  if (pending.size > 0) {
    throw new HistoryError(`end of history: tool calls [${[...pending].join(", ")}] were never answered`);
  }
}

/** Same call = same tool + same arguments, ignoring whitespace differences. */
export function callKey(call: ToolCall): string {
  let args = call.function.arguments;
  try {
    args = JSON.stringify(JSON.parse(args || "{}"));
  } catch {
    // invalid JSON: keep the raw string as the key
  }
  return `${call.function.name}:${args}`;
}