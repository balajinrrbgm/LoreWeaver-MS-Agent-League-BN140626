# 🤖 How GitHub Copilot Built LoreWeaver

> Required by the Creative Apps challenge: *"Your project must demonstrate meaningful use of GitHub Copilot during development."*

LoreWeaver was designed and implemented end-to-end with **GitHub Copilot in VS Code**, using all four modes. This document records how.

## Where Copilot accelerated the build

| Area | Copilot mode | What it did |
|---|---|---|
| Concept & architecture | **Plan / Ask** | Brainstormed the "grounded interactive fiction" concept and mapped it to the judging rubric and the Foundry IQ agentic-retrieval pattern. |
| Foundry IQ integration | **Agent** | Scaffolded `foundryIQ.ts` — the live agentic-retrieval call *and* the offline grounding fallback with sub-query planning + BM25-style ranking. |
| 4-stage story engine | **Agent** | Generated `storyEngine.ts`, the Retrieve→Plan→Narrate→Branch pipeline and the deterministic grounded narrator. |
| Frontend studio | **Agent / Edit** | Built the atmospheric SPA, inline citation chips, and the live reasoning-trace panel. |
| MCP server | **Agent** | Wrote the `@modelcontextprotocol/sdk` server exposing tools to Copilot. |
| Safety layer | **Edit** | Added content-safety + prompt-injection screens with explainable refusals. |
| Refactors & types | **Inline chat (Ctrl+I)** | Tightened types, extracted helpers, and hardened input validation. |

## Representative prompts used

- *"Create a Foundry IQ grounding service that runs agentic retrieval when configured and an equivalent offline pipeline (plan sub-queries → rank lore → cite) otherwise."*
- *"Build a 4-stage story engine that only asserts facts present in the grounded canon and appends `[L#]` citation markers."*
- *"Generate a polished dark-themed storytelling UI with citation chips that reveal the source on hover."*
- *"Expose the story engine as an MCP server with `weave_scene`, `ground_lore`, and `add_lore` tools."*

## Validation discipline

Following the starter kit's guidance, every Copilot suggestion was **tested incrementally** (`npm run dev`, `npm run typecheck`) and reviewed for correctness, security (no secrets, input limits), and graceful degradation before being accepted.
