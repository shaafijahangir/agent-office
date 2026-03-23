# Agent Office - AI Business Team Simulator

## What This Is
A pixel-art virtual office where 10 AI agents (powered by Ollama/local LLMs) work as a startup team. You talk to the Manager (Jordan), who delegates to Tech, Sales, and Business teams. Agents think, talk to each other, use tools, and work on tasks — all visualized in real-time.

## Architecture

```
packages/
  core/       - Agent brain, memory, task manager, office grid (shared lib)
  adapters/   - LLM adapters (Ollama, OpenAI, etc.)
  server/     - Colyseus game server, rooms, tools, SQLite memory
  ui/         - React + Phaser.js pixel art frontend
  cli/        - CLI entry point
```

**Stack**: TypeScript monorepo, Colyseus (real-time WebSocket), Phaser.js (2D rendering), React (UI panels), Ollama (local LLM), SQLite (memory persistence).

## The 4 Agents (1 per department)

| Agent | Role | Department | ID | Tools |
|-------|------|------------|----|-------|
| Jordan | CEO/Manager | Executive | `manager` | create_task, write_report, web_search |
| Alex | CTO | Tech | `cto` | code_execute, code_review, architecture_plan |
| Morgan | VP Sales | Sales | `vp-sales` | market_research, draft_outreach, web_search |
| Taylor | CFO | Business | `cfo` | financial_model, risk_analysis, market_research, write_report, web_search |

## Key Files

- `packages/core/src/agent/Agent.ts` - Agent class: think cycle, inbox, memory, decision-making
- `packages/core/src/agent/AgentConfig.ts` - Config types: InferenceConfig, PersonalityConfig, Capability
- `packages/core/src/agent/InferenceAdapter.ts` - LLM interface: CompletionRequest/Response types
- `packages/adapters/src/OllamaAdapter.ts` - Ollama HTTP adapter (POST to localhost:11434)
- `packages/server/src/rooms/OfficeRoom.ts` - Main game room: agent setup, think loop, action handling, movement
- `packages/server/src/tools/ToolExecutor.ts` - Tool implementations (code_execute, web_search, financial_model, etc.)
- `packages/server/src/memory/MemoryStore.ts` - SQLite-backed memory persistence
- `packages/ui/src/game/Game.ts` - Phaser scene: office layout, sprites, team zones
- `packages/ui/src/components/ChatPanel.tsx` - Chat UI
- `packages/ui/src/components/TaskBoard.tsx` - Task assignment UI

## How the Agent Loop Works

1. Every ~15s per agent, `OfficeRoom.update()` calls `agent.think(perception)`
2. `think()` builds a prompt with context (nearby agents, messages, task + stage, memories)
3. Sends to Ollama, parses JSON decision: `{ thought, action, target, message, toolCall }`
4. OfficeRoom handles the decision: route messages, execute tools, advance task stages, move sprites
5. Ollama processes one request at a time — agents light up sequentially

## Task Pipeline

Tasks flow through stages: `proposed` → `planned` → `implementing` → `reviewing` → `done`

- Agents propose tasks when idle and have < 3 active tasks (`propose_task` action)
- `complete_task` advances to the next stage (not straight to done)
- At `reviewing` stage, task is routed to a cross-reviewer (Jensen→Warren, Linus→Jensen, Marc→Warren, Warren→Linus)
- Reviewer can APPROVE (→done) or request REVISE (→back to implementing with feedback)

## Build & Run

```bash
# Build (order matters — core first)
npm run build --workspace=packages/core
npm run build --workspace=packages/adapters
npm run build --workspace=packages/server
npm run build --workspace=packages/cli
# UI uses Vite (no pre-build needed for dev)

# Run
cd packages/server && node dist/index.js   # Server on :3000
cd packages/ui && npx vite                  # UI on :5173

# Prereq: Ollama running with llama3.2
ollama serve
ollama pull llama3.2:latest
```

## Current State

- P0 done: agents auto-start, health checks, task completion
- P0.5 done: 4 agents with real personas (Jensen/Linus/Marc/Warren)
- P1 done: task pipeline with stages (proposed→planned→implementing→reviewing→done), auto-propose, cross-review
- P2 next: tools still return templates — need real artifacts
- See `ROADMAP.md` for priorities

## "Chef It Up" Protocol

When the user says **"chef it up"**, execute the following:

1. **Read `ROADMAP.md`** to get the current priority list.
2. **Find the highest-priority unchecked item** (P0 before P1, top of each section first).
3. **Plan before coding**: briefly state what you're about to do and which files you'll touch. If the change is large (touches 3+ files or changes core logic), use plan mode first to align.
4. **Implement it**:
   - Read every file you're about to modify first.
   - Follow the build order: core → adapters → server → cli → ui.
   - Make the minimal change that solves the item. No gold-plating.
   - If a DB migration is needed, write it as an `ALTER TABLE IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS` in `MemoryStore.initialize()`.
5. **Verify it works**: build the affected packages (`npm run build --workspace=packages/<pkg>`). Fix any TypeScript errors before moving on.
6. **Mark it done**: check off the item in `ROADMAP.md` with `[x]`.
7. **Move to the next item** in the same priority tier. Keep going until:
   - The user says stop, OR
   - You hit a design decision that needs user input, OR
   - You've completed all items in the current P-level.
8. At the end of each P-level, give a short status update: what was done, what's next.

**Rules during "chef it up":**
- Don't ask for confirmation on each item — just go. The roadmap IS the confirmation.
- If something is blocked (e.g., needs Ollama running to test), note it and skip to the next unblocked item.
- If you discover a new bug or issue while implementing, add it to `ROADMAP.md` under the appropriate P-level rather than fixing it ad-hoc.
- Always build after changes. If the build breaks, fix it before moving on.
- Commit nothing unless the user asks. They'll review the diff.

## Conventions

- Build order: core -> adapters -> server -> cli -> ui
- Agent IDs are kebab-case: `manager`, `cto`, `lead-dev`, `vp-sales`, etc.
- All agent definitions live in `TEAM_ROSTER` array in `OfficeRoom.ts`
- Tools are routed through `ToolExecutor.execute()` switch statement
- Colyseus broadcasts messages to UI via `this.broadcast('chat', ...)`
- Sprite keys: `char_0` through `char_5` mapped to agents in `Game.ts`
