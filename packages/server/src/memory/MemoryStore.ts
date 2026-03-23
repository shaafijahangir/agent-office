import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { MemoryEntry } from '@agent-office/core';

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

export class MemoryStore {
    private db?: Database;
    private ollamaUrl: string;

    constructor(ollamaUrl: string = 'http://localhost:11434') {
        this.ollamaUrl = ollamaUrl;
    }

    async initialize(dbPath: string = './data/office-memory.db') {
        // Ensure data directory exists
        const { mkdir } = await import('fs/promises');
        const path = await import('path');
        await mkdir(path.dirname(dbPath), { recursive: true });

        this.db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                content TEXT NOT NULL,
                type TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                embedding TEXT,
                session_id TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
            CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                assigned_to TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT DEFAULT (datetime('now')),
                completed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS office_layout (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                layout_json TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT 'default',
                updated_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_name TEXT NOT NULL,
                from_id TEXT NOT NULL,
                to_name TEXT NOT NULL,
                to_id TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_conversations_time ON conversations(timestamp DESC);

            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                action TEXT NOT NULL,
                thought TEXT,
                target TEXT,
                message TEXT,
                tool TEXT,
                task TEXT,
                timestamp TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_logs(timestamp DESC);
        `);

        // Migration: add embedding column to existing databases
        try {
            await this.db.exec('ALTER TABLE memories ADD COLUMN embedding TEXT');
        } catch {
            // Column already exists — ignore
        }

        // Migration: add task_id to conversations for topic threading
        try { await this.db.exec('ALTER TABLE conversations ADD COLUMN task_id INTEGER'); } catch { /* exists */ }
        try { await this.db.exec('ALTER TABLE conversations ADD COLUMN task_title TEXT'); } catch { /* exists */ }

        // Migration: add task pipeline columns
        const taskMigrations = [
            "ALTER TABLE tasks ADD COLUMN stage TEXT DEFAULT 'pending'",
            "ALTER TABLE tasks ADD COLUMN description TEXT",
            "ALTER TABLE tasks ADD COLUMN deliverable TEXT",
            "ALTER TABLE tasks ADD COLUMN reviewed_by TEXT",
            "ALTER TABLE tasks ADD COLUMN stage_updated_at TEXT",
        ];
        for (const sql of taskMigrations) {
            try { await this.db.exec(sql); } catch { /* column already exists */ }
        }

        console.log('[MemoryStore] SQLite initialized at', dbPath);
    }

    // --- Embedding Generation ---

    private async generateEmbedding(text: string): Promise<number[] | null> {
        try {
            const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'llama3.2:latest', prompt: text })
            });
            const data = await res.json();
            return data.embedding || null;
        } catch {
            return null;
        }
    }

    // --- Memory Operations ---

    async saveMemory(agentId: string, entry: MemoryEntry, sessionId?: string): Promise<void> {
        if (!this.db) return;
        // Generate embedding for semantic search (async, non-blocking)
        let embeddingStr: string | null = null;
        if (entry.importance >= 0.5) {
            const embedding = await this.generateEmbedding(entry.content);
            if (embedding) embeddingStr = JSON.stringify(embedding);
        }
        await this.db.run(
            'INSERT INTO memories (agent_id, content, type, timestamp, importance, embedding, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [agentId, entry.content, entry.type, entry.timestamp, entry.importance, embeddingStr, sessionId || null]
        );
    }

    async saveMemories(agentId: string, entries: MemoryEntry[], sessionId?: string): Promise<void> {
        for (const entry of entries) {
            await this.saveMemory(agentId, entry, sessionId);
        }
    }

    async loadMemories(agentId: string, limit: number = 20): Promise<MemoryEntry[]> {
        if (!this.db) return [];
        const rows = await this.db.all(
            'SELECT content, type, timestamp, importance FROM memories WHERE agent_id = ? ORDER BY importance DESC, created_at DESC LIMIT ?',
            [agentId, limit]
        );
        return rows.map((r: any) => ({
            content: r.content,
            type: r.type,
            timestamp: r.timestamp,
            importance: r.importance
        }));
    }

    async semanticSearch(agentId: string, query: string, topK: number = 5): Promise<MemoryEntry[]> {
        if (!this.db) return [];
        const queryEmbedding = await this.generateEmbedding(query);
        if (!queryEmbedding) return this.loadMemories(agentId, topK); // Fallback to recency

        const rows = await this.db.all(
            'SELECT content, type, timestamp, importance, embedding FROM memories WHERE agent_id = ? AND embedding IS NOT NULL',
            [agentId]
        );

        const scored = rows.map((r: any) => {
            const emb = JSON.parse(r.embedding);
            const score = cosineSimilarity(queryEmbedding, emb);
            return { content: r.content, type: r.type, timestamp: r.timestamp, importance: r.importance, score };
        }).sort((a, b) => b.score - a.score);

        return scored.slice(0, topK).map(s => ({
            content: s.content,
            type: s.type,
            timestamp: s.timestamp,
            importance: s.importance
        }));
    }

    // --- Task Operations ---

    async createTask(title: string, assignedTo?: string): Promise<number> {
        if (!this.db) return -1;
        const result = await this.db.run(
            'INSERT INTO tasks (title, assigned_to) VALUES (?, ?)',
            [title, assignedTo || null]
        );
        return result.lastID || -1;
    }

    async getTasks(): Promise<any[]> {
        if (!this.db) return [];
        return this.db.all('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50');
    }

    async assignTask(taskId: number, agentId: string): Promise<void> {
        if (!this.db) return;
        await this.db.run('UPDATE tasks SET assigned_to = ?, status = ? WHERE id = ?', [agentId, 'in_progress', taskId]);
    }

    async completeTask(taskId: number): Promise<void> {
        if (!this.db) return;
        await this.db.run("UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [taskId]);
    }

    async completeTaskByAgent(agentId: string): Promise<void> {
        if (!this.db) return;
        // Complete the oldest pending/in_progress task for this agent
        const task = await this.db.get(
            "SELECT id FROM tasks WHERE assigned_to = ? AND status != 'completed' ORDER BY created_at ASC LIMIT 1",
            [agentId]
        );
        if (task) {
            await this.db.run("UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?", [task.id]);
        }
    }

    // ─── Task Pipeline Methods ───

    /** Count active (non-done) tasks for an agent */
    async countActiveTasksByAgent(agentId: string): Promise<number> {
        if (!this.db) return 0;
        const row = await this.db.get(
            "SELECT COUNT(*) as count FROM tasks WHERE assigned_to = ? AND status != 'completed' AND stage != 'done'",
            [agentId]
        );
        return row?.count || 0;
    }

    /** Get the current active task for an agent (oldest non-done) */
    async getActiveTaskForAgent(agentId: string): Promise<any | null> {
        if (!this.db) return null;
        return this.db.get(
            "SELECT * FROM tasks WHERE assigned_to = ? AND status != 'completed' AND stage != 'done' ORDER BY created_at ASC LIMIT 1",
            [agentId]
        );
    }

    /** Create a proposed task */
    async createProposedTask(title: string, description: string, assignedTo: string): Promise<number> {
        if (!this.db) return -1;
        const result = await this.db.run(
            "INSERT INTO tasks (title, description, assigned_to, status, stage, stage_updated_at) VALUES (?, ?, ?, 'in_progress', 'proposed', datetime('now'))",
            [title, description, assignedTo]
        );
        return result.lastID || -1;
    }

    /** Advance task to the next stage. Returns the new stage or null if already done. */
    async advanceTaskStage(taskId: number, deliverable?: string): Promise<string | null> {
        if (!this.db) return null;
        const task = await this.db.get("SELECT * FROM tasks WHERE id = ?", [taskId]);
        if (!task) return null;

        const STAGE_ORDER = ['proposed', 'planned', 'implementing', 'reviewing', 'done'];
        const currentIdx = STAGE_ORDER.indexOf(task.stage || 'proposed');
        if (currentIdx < 0 || currentIdx >= STAGE_ORDER.length - 1) return null;

        const nextStage = STAGE_ORDER[currentIdx + 1];

        if (nextStage === 'done') {
            await this.db.run(
                "UPDATE tasks SET stage = ?, stage_updated_at = datetime('now'), deliverable = COALESCE(?, deliverable), status = 'completed', completed_at = datetime('now') WHERE id = ?",
                [nextStage, deliverable || null, taskId]
            );
        } else {
            await this.db.run(
                "UPDATE tasks SET stage = ?, stage_updated_at = datetime('now'), deliverable = COALESCE(?, deliverable) WHERE id = ?",
                [nextStage, deliverable || null, taskId]
            );
        }

        return nextStage;
    }

    /** Assign a reviewer to a task */
    async setTaskReviewer(taskId: number, reviewerId: string): Promise<void> {
        if (!this.db) return;
        await this.db.run("UPDATE tasks SET reviewed_by = ? WHERE id = ?", [reviewerId, taskId]);
    }

    /** Get tasks awaiting review by a specific reviewer */
    async getTasksForReview(reviewerId: string): Promise<any[]> {
        if (!this.db) return [];
        return this.db.all(
            "SELECT * FROM tasks WHERE reviewed_by = ? AND stage = 'reviewing' ORDER BY stage_updated_at ASC",
            [reviewerId]
        );
    }

    // --- Layout Operations ---

    async saveLayout(name: string, layoutJson: string): Promise<void> {
        if (!this.db) return;
        const existing = await this.db.get('SELECT id FROM office_layout WHERE name = ?', [name]);
        if (existing) {
            await this.db.run("UPDATE office_layout SET layout_json = ?, updated_at = datetime('now') WHERE name = ?", [layoutJson, name]);
        } else {
            await this.db.run('INSERT INTO office_layout (name, layout_json) VALUES (?, ?)', [name, layoutJson]);
        }
    }

    async loadLayout(name: string = 'default'): Promise<any | null> {
        if (!this.db) return null;
        const row = await this.db.get('SELECT layout_json FROM office_layout WHERE name = ?', [name]);
        return row ? JSON.parse(row.layout_json) : null;
    }

    // --- Conversation Persistence ---

    async saveConversation(msg: { from: string; fromId: string; to: string; toId: string; content: string; timestamp: string; taskId?: number; taskTitle?: string }): Promise<void> {
        if (!this.db) return;
        await this.db.run(
            'INSERT INTO conversations (from_name, from_id, to_name, to_id, content, timestamp, task_id, task_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [msg.from, msg.fromId, msg.to, msg.toId, msg.content, msg.timestamp, msg.taskId || null, msg.taskTitle || null]
        );
    }

    async getRecentConversations(limit: number = 200): Promise<any[]> {
        if (!this.db) return [];
        const rows = await this.db.all(
            'SELECT from_name as "from", from_id as "fromId", to_name as "to", to_id as "toId", content, timestamp, task_id as "taskId", task_title as "taskTitle" FROM conversations ORDER BY timestamp DESC LIMIT ?',
            [limit]
        );
        return rows.reverse(); // oldest first
    }

    // --- Activity Log Persistence ---

    async saveActivityLog(log: { agentId: string; agentName: string; action: string; thought: string; target: string; message: string; tool: string; task: string; timestamp: string }): Promise<void> {
        if (!this.db) return;
        await this.db.run(
            'INSERT INTO activity_logs (agent_id, agent_name, action, thought, target, message, tool, task, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [log.agentId, log.agentName, log.action, log.thought, log.target, log.message, log.tool, log.task, log.timestamp]
        );
    }

    async getRecentActivityLogs(limit: number = 200): Promise<any[]> {
        if (!this.db) return [];
        const rows = await this.db.all(
            'SELECT agent_id as "agentId", agent_name as "agentName", action, thought, target, message, tool, task, timestamp FROM activity_logs ORDER BY timestamp DESC LIMIT ?',
            [limit]
        );
        return rows.reverse(); // oldest first
    }

    async close(): Promise<void> {
        if (this.db) await this.db.close();
    }
}
