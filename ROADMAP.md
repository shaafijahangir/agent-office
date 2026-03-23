# Agent Office — Priorities

> Last updated: 2026-03-22

## Done

- [x] **P0 — System basics**: Agents auto-start, task dedup, task completion via `complete_task` action, Ollama health check + heartbeat
- [x] **P0.5 — Personas**: Jensen (CEO/Jensen Huang), Linus (CTO/Linus Torvalds), Marc (VP Sales/Marc Benioff), Warren (CFO/Warren Buffett)

---

## Done: P1 — Task Pipeline

**Goal**: Agents autonomously propose work and move it through stages. This is the core loop.

- [x] Add `stage`, `description`, `deliverable`, `reviewed_by`, `stage_updated_at` columns to `tasks` table
- [x] Stages: `proposed` → `planned` → `implementing` → `reviewing` → `done`
- [x] Agents propose tasks when they have < 3 active tasks (propose_task action)
- [x] Stage transitions via `complete_task` — advances one stage at a time
- [x] Review routing: Jensen→Warren, Linus→Jensen, Marc→Warren, Warren→Linus (cross-review)
- [x] Review feedback loop: reviewer can APPROVE (→done) or REVISE (→back to implementing)
- [x] UI: stage badges with colors, stage counts in header
- [x] Tasks restored from DB on server restart

## Next: P2 — Real Tools

**Goal**: Tools produce actual output instead of template strings.

- [ ] `artifacts` table to store agent-produced documents
- [ ] `write_report`, `architecture_plan`, `draft_outreach` → save real LLM output to artifacts
- [ ] `financial_model` → save full projection as artifact
- [ ] UI: artifacts tab showing deliverables per agent/task

## Later: P3 — Memory & Hardening

- [ ] Dedup memories (same agent, similar text within 1hr)
- [ ] Prune old low-importance memories, cap at 200/agent
- [ ] Structured logging, log rotation
- [ ] Process management (pm2/systemd for 24/7)
