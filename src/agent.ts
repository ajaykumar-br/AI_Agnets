// =============================================================================
// agent.ts — The agent loop. This is the most important file of the lesson.
//
//   user request → model → (tool call? → validate → execute → append result → model)* → answer
// =============================================================================
import { callModel, type CallModelOptions } from "./llm.js";
import { toolRegistry, toToolDefinition, tools, getToolDefinitions } from "./tools.js";
import type { Message, ToolCall, ToolMessage } from "./types.js";
import { z } from "zod";

export interface AgentOptions extends CallModelOptions {
  maxSteps?: number; // hard cap on model calls — your infinite-loop guard
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
  stoppedReason: "final_answer" | "max_steps" | "truncated";
}

function toolError(call: ToolCall, error: string): { message: ToolMessage; ok: false } {
  return {
    message: { role: "tool", tool_call_id: call.id, content: JSON.stringify({ error }) },
    ok: false,
  };
}

/**
 * Turn ONE model-requested tool call into ONE tool message.
 *
 * Design rule: this function never throws. Every failure becomes a tool
 * message the model can read and recover from. Ask yourself why that is
 * usually better than crashing the loop — and when it wouldn't be.
 */
export async function executeToolCall(call: ToolCall): Promise<{ message: ToolMessage; ok: boolean }> {
  // TODO 9: Look up call.function.name in toolRegistry.
  //   Unknown tool → error result (models do hallucinate tool names).
  const tool = toolRegistry.get(call.function.name);
  if (!tool) {
  return toolError(call, `Unknown tool "${call.function.name}". Available: ${[...toolRegistry.keys()].join(", ")}`);
}

  // TODO 10: JSON.parse(call.function.arguments) inside try/catch.
  //   Invalid JSON → error result.
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments);
  } catch (err) {
    return toolError(call, `Invalid JSON arguments for tool ${call.function.name}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // TODO 11: tool.schema.safeParse(parsed).
  //   Failure → error result that includes the Zod issues, so the model can fix its args.
  const validated = tool.schema.safeParse(parsed);
  if (!validated.success) {
    return toolError(call, `Invalid arguments for tool ${call.function.name}: ${z.prettifyError(validated.error)}`);
  }

  // TODO 12: await tool.execute(validated.data) inside try/catch.
  //   Success → JSON.stringify the result. Throw → error result with the message.

  let result: unknown;
  try {
    result = await tool.execute(validated.data);
  } catch (err) {
    return toolError(call, `error executing tool ${call.function.name}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Every path returns: { role: "tool", tool_call_id: call.id, content: <string> }

  let content: string;
  try {
    content = JSON.stringify(result);
  } catch (err) {
    return toolError(call, `error serializing result of tool ${call.function.name}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    message: {
      role: "tool",
      tool_call_id: call.id,
      content: content,
    },
    ok: true,
  }
}

export async function runAgent(userInput: string, opts: AgentOptions): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 8;
  const toolDefs = tools.map(toToolDefinition);
  const trace = opts.onTrace ?? (() => {});

  const messages: Message[] = [];
  // TODO 13: Push the system message (if any) and the user message.
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: userInput });

  for (let step = 1; step <= maxSteps; step++) {
    // TODO 14: trace model_call, then callModel(messages, toolDefs, opts).

    const toolDefs = getToolDefinitions(); // Get the current tool definitions from the registry
    trace({ type: "model_call", step, messageCount: messages.length });
    const modelTurn = await callModel(messages, toolDefs, opts);

    const toolCalls = modelTurn.message.tool_calls ?? [];

    trace({ type: "model_response", 
      step, 
      finishReason: modelTurn.finishReason, 
      content: modelTurn.message.content, 
      toolCalls: toolCalls.length
    });

    // TODO 15: Append the assistant message to `messages` EXACTLY as returned,
    //   including tool_calls. (What breaks if you skip this? Try it later.)
    messages.push(modelTurn.message);

    // TODO 16: No tool_calls → return { answer, steps, messages, stoppedReason: "final_answer" }.
    if (modelTurn.finishReason === "length") {
      return {
        answer: modelTurn.message.content ?? "",
        steps: step,
        messages,
        stoppedReason: "truncated",
      };
    }

    if (toolCalls.length === 0) {
      return {
        answer: modelTurn.message.content ?? "",
        steps: step,
        messages,
        stoppedReason: "final_answer",
      };
    }

    // TODO 17: For each tool call: trace it, executeToolCall(), append the ToolMessage,
    //   trace the result. Every tool_call id must get a matching tool message
    //   before the next model call, or the API will reject the request.

    for (const call of toolCalls) {
      trace({ type: "tool_call", step, name: call.function.name, rawArgs: call.function.arguments });
      const { message: toolMessage, ok } = await executeToolCall(call);
      messages.push(toolMessage);
      trace({ type: "tool_result", step, name: call.function.name, ok, content: toolMessage.content });
    }
  }

  // TODO 18: Hit maxSteps. Return a result with stoppedReason "max_steps".
  //   Decide what `answer` should be here.
  const lastMessage = messages[messages.length - 1];

  return {
    answer: `Stopped after ${maxSteps} steps without reaching a final answer.`,
    steps: maxSteps,
    messages,
    stoppedReason: "max_steps",
  };
}
