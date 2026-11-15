# Lesson 1 — Minimal agent loop (TypeScript)

## Setup
```bash
npm install
cp .env.example .env      # add your OpenRouter key and model id
npm run typecheck
npm start -- "What is 1234 * 5678, and what time is it in Tokyo?"
```

## Order to implement
1. `src/types.ts`: read only. This is the wire format.
2. `src/tools.ts`: TODO 5–8
3. `src/llm.ts`: TODO 1–4
4. `src/agent.ts`: TODO 9–18 (do `executeToolCall` first, then `runAgent`)

## Done when
- The example question gets answered and the trace shows the tool calls.
- `npm run typecheck` passes with no `any` added.
- You can say, without looking, what happens on each step of the trace.
