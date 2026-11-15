// =============================================================================
// tools.ts — Tool definitions. Each tool = schema (what the model sees and what
// you validate against) + execute (what YOUR code actually runs).
// One Zod schema is the single source of truth for both.
// =============================================================================
import { z } from "zod";
import type { ToolDefinition } from "./types.js";

export interface Tool<S extends z.ZodType = z.ZodType> {
  id: number;
  name: string;
  description: string; // the model chooses tools mostly from this text — write it well
  schema: S;
  execute: (args: z.infer<S>) => Promise<unknown>;
}

/** Helper so each tool keeps its own precise arg types. */
export function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool;
}

// --- Tool 1: calculator (schema given, execute is yours) ----------------------

const calculatorSchema = z.object({
  op: z.enum(["add", "subtract", "multiply", "divide"]).describe("Arithmetic operation"),
  a: z.number().describe("First operand"),
  b: z.number().describe("Second operand"),
});

export const calculator = defineTool({
  id: 1,
  name: "calculator",
  description:
    "Perform one exact arithmetic operation on two numbers. Use this instead of doing arithmetic yourself.",
  schema: calculatorSchema,
  execute: async ({op, a, b}) => {
    let result: number;
    switch(op) {
      case "add":
        result = a + b;
        break;
      case "subtract":
        result = a - b;
        break;
      case "multiply":
        result = a * b;
        break;
      case "divide":
        if (b === 0) {
          throw new Error("Division by zero is undefined. Ask the user for a non-zero divisor.");
        }
        result = a / b;
        break;
      default: {
        const unreachable: never = op;
        throw new Error(`Unsupported operation: ${String(unreachable)}`);
      }
    }
    if (!Number.isFinite(result)) {
      throw new Error(`Result is not a finite number (overflow): ${op}(${a}, ${b})`);
    }

    return { op, a, b, result };
  },
});

// --- Tool 2: get_current_time (you write schema AND execute) -----------------

export const getCurrentTime = defineTool({
  id: 2,
  name: "get_current_time",
  description: "Get the current date and time in a given IANA timezone. Use this whenever the user asks what time or date it is somewhere.",
  schema: z.object({
    timezone: z
      .string()
      .describe('IANA timezone name, e.g. "America/New_York", "Asia/Tokyo", "UTC"'),
  }),
  execute: async ({ timezone }) => {
    const now = new Date();
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "long",
    }).format(now);

    return { timezone, local, utc: now.toISOString() };
  },
});

// --- Registry -----------------------------------------------------------------

export const tools: Tool[] = [calculator, getCurrentTime] as Tool[];

const toolRegistry: Map<string, Tool> = new Map(tools.map((t) => [t.name, t]));
toolRegistry.delete("get_current_time"); // for testing unknown tool calls
export { toolRegistry };

/** Convert our Tool into the wire-format definition the model receives. */
// export function toToolDefinition(toolRegistry: Map<string, Tool>): ToolDefinition {
//   // TODO 8: Return { type: "function", function: { name, description, parameters } }.
//   //   parameters = z.toJSONSchema(tool.schema). Log the output once and look at it:
//   //   this JSON is literally all the model knows about your tool.
//   const tool = toolRegistry.get(toolRegistry.keys().next().value);
//   if (!tool) {
//     throw new Error("Tool not found in registry");
//   }
//   const parameters = z.toJSONSchema(tool.schema);

//   const wireFormat: ToolDefinition = {
//     type: "function",
//     function: {
//       name: tool.name,
//       description: tool.description,
//       parameters: parameters
//     } 
//   };

//   return wireFormat;
// }

// Newer version for building from toolRegistry Map instead of a tool array
export function toToolDefinition(tool: Tool): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema),
    },
  };
}

/** What the model sees is always derived from what can actually run. */
export function getToolDefinitions(registry: Map<string, Tool> = toolRegistry): ToolDefinition[] {
  return [...registry.values()].map(toToolDefinition);
}