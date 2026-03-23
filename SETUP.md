# Setup Guide

## Prerequisites

- **Node.js** 18+ and npm
- **Ollama** installed and running (`ollama serve`)
- **Model pulled**: `ollama pull llama3.2:latest` (2GB)

## Install

```bash
cd agent-office
npm install
```

## Build

Packages must be built in dependency order:

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/adapters
npm run build --workspace=packages/server
npm run build --workspace=packages/cli
```

The UI (`packages/ui`) runs via Vite dev server — no pre-build needed for development.

## Run

Terminal 1 — Ollama:
```bash
ollama serve
```

Terminal 2 — Game server:
```bash
cd packages/server
node dist/index.js
# Server starts on ws://localhost:3000
```

Terminal 3 — Frontend:
```bash
cd packages/ui
npx vite
# Opens on http://localhost:5173
```

## Verify

1. Open http://localhost:5173
2. You should see the pixel art office with 4 team zones
3. 10 agents spawn at their desks
4. Open the TaskBoard panel and assign a task to Jordan
5. Watch agents start thinking (speech bubbles appear one by one — Ollama is sequential)

## Project Structure

```
agent-office/
├── packages/
│   ├── core/           TypeScript library — Agent, Memory, Task, Office types
│   │   └── src/
│   │       ├── agent/      Agent.ts (think cycle), AgentConfig.ts, InferenceAdapter.ts
│   │       ├── memory/     MemoryManager.ts
│   │       ├── task/       TaskManager.ts
│   │       └── office/     Office.ts, Grid.ts
│   │
│   ├── adapters/       LLM adapters
│   │   └── src/
│   │       ├── OllamaAdapter.ts    POST to localhost:11434/api/chat
│   │       └── PromptBuilder.ts    (exists but unused — candidate for integration)
│   │
│   ├── server/         Colyseus game server
│   │   └── src/
│   │       ├── index.ts            Express + Colyseus setup on :3000
│   │       ├── rooms/
│   │       │   └── OfficeRoom.ts   Main room — agent init, think loop, action handling
│   │       ├── schema/
│   │       │   └── OfficeState.ts  Colyseus state schema (synced to all clients)
│   │       ├── tools/
│   │       │   └── ToolExecutor.ts Switch-based tool routing + implementations
│   │       ├── memory/
│   │       │   └── MemoryStore.ts  SQLite persistence for agent memories + tasks
│   │       └── db.ts              SQLite connection
│   │
│   ├── ui/             React + Phaser.js frontend
│   │   └── src/
│   │       ├── App.tsx             Main React app
│   │       ├── game/
│   │       │   └── Game.ts         Phaser scene — office layout, sprites, zones
│   │       └── components/
│   │           ├── ChatPanel.tsx    Agent chat feed
│   │           ├── TaskBoard.tsx    Task assignment UI
│   │           ├── AgentInspector.tsx  Agent detail view
│   │           ├── SystemLog.tsx    System event log
│   │           └── LayoutEditor.tsx Office layout editor
│   │
│   └── cli/            CLI entry point
│
├── CLAUDE.md           Project context for Claude Code
├── ROADMAP.md          Feature roadmap (5 phases)
└── SETUP.md            This file
```

## How It Works

```
User assigns task via TaskBoard
        │
        ▼
OfficeRoom receives 'assign-task' message
        │
        ▼
Sets agent.currentTask + broadcasts to UI
        │
        ▼
Every ~15s, OfficeRoom.update() fires per agent:
        │
        ├── Build perception (nearby agents, messages, task, memories)
        ├── agent.think(perception) → sends prompt to Ollama
        ├── Ollama returns JSON decision
        ├── Parse: { thought, action, target, message, toolCall }
        └── Handle action:
            ├── talk → route message to target agent + broadcast to chat
            ├── use_tool → ToolExecutor.execute() + broadcast result
            ├── work → update state
            └── idle → stay at desk
```

## Troubleshooting

**Port 3000 already in use**: A previous server instance is still running. Kill it or use a different port.

**Ollama not responding**: Make sure `ollama serve` is running and the model is pulled (`ollama list` should show `llama3.2:latest`).

**Build fails with "cannot find module @agent-office/core"**: Build in order — core must be built before adapters, adapters before server.

**Agents not thinking**: Check server console for errors. Ollama processes one request at a time, so with 10 agents each cycle takes ~2-3 minutes to complete all agents.
