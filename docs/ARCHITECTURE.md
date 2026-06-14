# 🏗️ LoreWeaver Architecture

This document is the architecture diagram + narrative required for submission, showing how the solution uses **Foundry IQ** (Microsoft IQ) and **GitHub Copilot**.

## System overview

```mermaid
flowchart TB
    subgraph Client["Surfaces (one engine, two front doors)"]
      WEB["🎨 Web Studio<br/>public/ (HTML/CSS/JS)"]
      COP["🤖 GitHub Copilot<br/>via MCP (.vscode/mcp.json)"]
    end

    API["Express API<br/>src/server/index.ts"]
    MCP["MCP Server<br/>src/mcp/server.ts"]

    subgraph ENGINE["StoryEngine — agentic pipeline (src/server/storyEngine.ts)"]
      direction TB
      S1["① Retrieve"] --> S2["② Plan"] --> S3["③ Narrate"] --> S4["④ Branch"]
    end

    subgraph IQ["Foundry IQ grounding (src/server/foundryIQ.ts)"]
      LIVE["Live: Azure AI Search<br/>agentic retrieval KB"]
      OFF["Offline: in-process<br/>sub-query + rank + cite"]
    end

    NAR["Narrator (src/server/narrator.ts)<br/>Azure OpenAI ⇄ procedural fallback"]
    DB[("World Bible<br/>data/seed + data/worlds")]
    SAFE["Safety screens<br/>src/server/safety.ts"]

    WEB --> API --> ENGINE
    COP --> MCP --> ENGINE
    S1 --> IQ
    LIVE -. credentials? .-> OFF
    S3 --> NAR
    ENGINE --> DB
    ENGINE --> SAFE
```

## Request lifecycle (weave a scene)

```mermaid
sequenceDiagram
    participant U as Reader / Copilot
    participant E as StoryEngine
    participant F as Foundry IQ
    participant N as Narrator

    U->>E: weave(world, prompt)
    E->>E: safety.screenInput(prompt)
    E->>F: ground(world, prompt)
    F->>F: plan sub-queries (agentic)
    F-->>E: cited canon + provenance
    E->>E: plan scene (honor canon)
    E->>N: narrate(system, grounded context)
    N-->>E: cited prose ([L#] markers)
    E->>E: derive branching choices
    E->>E: safety.screenOutput(prose)
    E-->>U: Scene { prose, citations, choices, trace }
```

## Design principles

- **Grounded-first.** No world fact is asserted without a retrieved citation.
- **Graceful degradation.** Both the IQ retrieval and the narrator have offline fallbacks, so the app is always runnable (critical for demo + Reliability score).
- **One engine, two surfaces.** Web studio and Copilot MCP share `StoryEngine`, avoiding drift.
- **Transparent reasoning.** The 4-stage trace is a first-class UI element, not a hidden detail.

## Foundry IQ integration points

| Concern | Implementation |
|---|---|
| Knowledge base | World bible (`data/`) → Azure AI Search agentic-retrieval KB when configured. |
| Agentic retrieval | `FoundryIQ.ground()` plans sub-queries, retrieves, reranks, returns citations. |
| Grounded answers w/ citations | `Citation[]` carried through to prose `[L#]` chips and the citations panel. |
| Permission-aware (future) | Live path runs against the KB; can be extended to per-caller Entra identity. |
```
