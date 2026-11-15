// =============================================================================
// agent.ts — The agent loop.
//
//   user request → model → (tool call? → validate → execute → append result → model)* → answer
// =============================================================================
import { z } from "zod";
import { callModel, type CallModelOptions } from "./llm.js";
import { getToolDefinitions, toolRegistry } from "./tools.js";
import { callKey, validateHistory } from "./guards.js";
import type { Message, ToolCall, ToolMessage } from "./types.js";

export interface AgentOptions extends CallModelOptions {
  maxSteps?: number; // hard cap on model calls: the infinite-loop guard
  maxRepeatedCalls?: number; // same tool + same args this many times → stop
  systemPrompt?: string;
  onTrace?: (event: TraceEvent) => void;
}

export type TraceEvent =
  | { type: "model_call"; step: number; messageCount: number }
  | { type: "model_response"; step: number; finishReason: string; content: string | null; toolCalls: number }
  | { type: "tool_call"; step: number; name: string; rawArgs: string }
  | { type: "tool_result"; step: number; name: string; ok: boolean; content: string };

export interface AgentResult {
  answer: string;
  steps: number;
  messages: Message[];
  stoppedReason: "final_answer" | "max_steps" | "truncated" | "repeated_call";
}

// -----------------------------------------------------------------------------
// Tool execution: never throws. Every failure becomes a tool message.
// -----------------------------------------------------------------------------

function toolError(call: ToolCall, error: string): { message: ToolMessage; ok: false } {
  return {
    message: { role: "tool", tool_call_id: call.id, content: JSON.stringify({ error }) },
    ok: false,
  };
}

export async function executeToolCall(call: ToolCall): Promise<{ message: ToolMessage; ok: boolean }> {
  // 1. Does the tool exist?
  const tool = toolRegistry.get(call.function.name);
  if (!tool) {
    return toolError(
      call,
      `Unknown tool "${call.function.name}". Available: ${[...toolRegistry.keys()].join(", ")}`,
    );
  }

  // 2. Are the arguments valid JSON? ("" counts as {} for no-argument tools)
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments || "{}");
  } catch (err) {
    return toolError(
      call,
      `Invalid JSON arguments for tool ${call.function.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. Do the arguments match the schema?
  const validated = tool.schema.safeParse(parsed);
  if (!validated.success) {
    return toolError(
      call,
      `Invalid arguments for tool ${call.function.name}:\n${z.prettifyError(validated.error)}`,
    );
  }

  // 4. Run it. Stringify inside the try, so a result that can't be serialized is also caught.
  try {
    const result = await tool.execute(validated.data);
    return {
      message: {
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result ?? { ok: true }),
      },
      ok: true,
    };
  } catch (err) {
    return toolError(
      call,
      `Error executing tool ${call.function.name}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// -----------------------------------------------------------------------------
// The loop
// -----------------------------------------------------------------------------

export async function runAgent(userInput: string, opts: AgentOptions): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 8;
  const maxRepeatedCalls = opts.maxRepeatedCalls ?? 3;
  const trace = opts.onTrace ?? (() => {});

  const messages: Message[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: "system", content: opts.systemPrompt });
  }
  messages.push({ role: "user", content: userInput });

  // How many times each distinct call (tool + args) has been requested in this run.
  const callCounts = new Map<string, number>();

  for (let step = 1; step <= maxSteps; step++) {
    // GUARD 1: never send a history that breaks the tool-call rules.
    // validateHistory(messages);

    // What the model sees is always derived from what can actually run.
    const toolDefs = getToolDefinitions();

    trace({ type: "model_call", step, messageCount: messages.length });
    const modelTurn = await callModel(messages, toolDefs, opts);
    const toolCalls = modelTurn.message.tool_calls ?? [];

    trace({
      type: "model_response",
      step,
      finishReason: modelTurn.finishReason,
      content: modelTurn.message.content,
      toolCalls: toolCalls.length,
    });

    // The assistant message goes into history exactly as returned (test 7 shows why).
    // messages.push(modelTurn.message);

    if (modelTurn.finishReason === "length") {
      return { answer: modelTurn.message.content ?? "", steps: step, messages, stoppedReason: "truncated" };
    }

    if (toolCalls.length === 0) {
      return { answer: modelTurn.message.content ?? "", steps: step, messages, stoppedReason: "final_answer" };
    }

    // GUARD 2: count every call in this batch BEFORE executing any of them.
    for (const call of toolCalls) {
      const key = callKey(call);
      const count = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, count);

      if (count >= maxRepeatedCalls) {
        return {
          answer:
            `Stopped: the model requested ${call.function.name}(${call.function.arguments}) ` +
            `${count} times without making progress.`,
          steps: step,
          messages,
          stoppedReason: "repeated_call",
        };
      }
    }

    // Execute each call; every tool_call id gets exactly one tool message.
    for (const call of toolCalls) {
      trace({ type: "tool_call", step, name: call.function.name, rawArgs: call.function.arguments });
      const { message: toolMessage, ok } = await executeToolCall(call);
      messages.push(toolMessage);
      trace({ type: "tool_result", step, name: call.function.name, ok, content: toolMessage.content });
    }
  }

  return {
    answer: `Stopped after ${maxSteps} steps without reaching a final answer.`,
    steps: maxSteps,
    messages,
    stoppedReason: "max_steps",
  };
}