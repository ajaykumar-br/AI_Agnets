// =============================================================================
// llm.ts — One HTTP call to the model. No SDK on purpose: you should see the
// raw request and response at least once.
// =============================================================================
import type { ChatCompletionResponse, Message, ModelTurn, ToolDefinition } from "./types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface CallModelOptions {
  model: string;
  apiKey: string;
  temperature?: number; // default to 0 while learning — easier to reproduce runs
  maxTokens?: number;
  timeoutMs?: number;
}

export class LLMError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
    this.name = "LLMError";
  }
}

export async function callModel(
  messages: Message[],
  tools: ToolDefinition[],
  opts: CallModelOptions,
): Promise<ModelTurn> {
  // TODO 1: Build the request body.
  //   Fields: model, messages, tools, tool_choice ("auto"), temperature, max_tokens.
  //   Question to answer for yourself: what should you send when tools is empty?

  const requestBody = {
    model: opts.model,
    messages,
    tools : tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? "auto" : undefined,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens,
  }

  // TODO 2: POST it with fetch().
  //   Headers: Authorization: `Bearer ${apiKey}`, Content-Type: application/json.
  //   Use AbortSignal.timeout(opts.timeoutMs ?? 60_000) for the timeout.
  let result: Response;
  try {
    result = await fetch(OPENROUTER_URL, { method: "POST",
    headers: {
      "Authorization": `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    body: JSON.stringify(requestBody) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new LLMError(`Model request timed out after ${opts.timeoutMs ?? 60_000}ms`);
    }
    throw new LLMError(`Network error calling model: ${err instanceof Error ? err.message : String(err)}`);
  }

  // TODO 3: Handle failure.
  //   Non-2xx → throw LLMError with status + response text (do NOT swallow the body;
  //   OpenRouter's error JSON is how you'll debug bad requests).
  //   Timeout/abort → throw LLMError with a clear message.

  if (!result.ok) {
    const body = await result.text();
    throw new LLMError(`Model request failed with status ${result.status}: ${body}`, result.status, body);
  }

  // TODO 4: Parse JSON as ChatCompletionResponse, take choices[0].
  //   If there is no choice, throw. Return { message, finishReason, usage }.

  const data: ChatCompletionResponse = await result.json();

  const choice = data.choices?.[0];
  if (!choice) throw new LLMError("No choices returned from model", result.status, JSON.stringify(data));

  return {
    message: choice.message,
    finishReason: choice.finish_reason,
    usage: data.usage,
  };
}
