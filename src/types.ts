// =============================================================================
// types.ts — The wire format. READ THIS FILE CAREFULLY; it is the lesson.
// These types mirror the OpenAI-compatible Chat Completions format that
// OpenRouter speaks. They are given complete: everything else builds on them.
// =============================================================================

/** A tool call the MODEL requests. It is only a request — nothing has run yet. */
export interface ToolCall {
  id: string; // you must echo this back in the tool result
  type: "function";
  function: {
    name: string;
    arguments: string; // NOTE: a JSON *string*, not an object. It may be invalid JSON.
  };
}

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

/** What the model returns. Either text, tool calls, or both. */
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

/** What YOUR application sends back after executing a tool. */
export interface ToolMessage {
  role: "tool";
  tool_call_id: string; // must match ToolCall.id
  content: string; // always a string — serialize results/errors yourself
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/** How a tool is advertised to the model (JSON Schema for parameters). */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema object
  };
}

/** Subset of the response body we care about. */
export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: AssistantMessage;
    finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** What callModel() hands back to the agent loop. */
export interface ModelTurn {
  message: AssistantMessage;
  finishReason: string;
  usage?: ChatCompletionResponse["usage"];
}
