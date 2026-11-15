// scratch.ts, run with: npx tsx src/scratch.ts
import { executeToolCall } from "./agent.js";
console.log(await executeToolCall({
  id: "test_1", type: "function",
  function: { name: "calculator", arguments: '{"op":"divide","a":10,"b":0}' },
}));