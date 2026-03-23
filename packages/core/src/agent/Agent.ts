import { AgentConfig } from './AgentConfig';
import { InferenceAdapter } from './InferenceAdapter';

export type AgentStateStatus = 'IDLE' | 'PERCEIVING' | 'THINKING' | 'ACTING' | 'COMMUNICATING';

export interface Perception {
    time: string;
    location: string;
    nearbyAgents: { name: string; role: string; distance: number }[];
    currentTask: any | null;
    taskStage?: string;
    activeTaskCount?: number;
    reviewTask?: { title: string; deliverable: string; author: string } | null;
    recentMessages: ConversationMessage[];
    memories: string[];
}

export interface Decision {
    thought: string;
    action: 'move' | 'talk' | 'work' | 'use_tool' | 'idle' | 'complete_task' | 'propose_task';
    target?: string;
    message?: string;
    toolCall?: { name: string; params: any };
}

export interface ActionResult {
    success: boolean;
    result?: any;
    error?: string;
}

export interface Event {
    type: string;
    data: any;
    timestamp: Date;
}

export interface Message {
    from: string;
    content: string;
}

export interface ConversationMessage {
    from: string;
    to: string;
    content: string;
    timestamp: string;
}

export interface MemoryEntry {
    content: string;
    type: 'thought' | 'conversation' | 'task_result' | 'observation' | 'achievement' | 'relationship';
    timestamp: string;
    importance: number; // 0-1
}

export interface QueuedTask {
    title: string;
    assignedAt: string;
}

export class Agent {
    public config: AgentConfig;
    private status: AgentStateStatus = 'IDLE';
    private adapter?: InferenceAdapter;

    // Conversation inbox (unread messages — cleared after processing)
    public inbox: ConversationMessage[] = [];

    // Conversation history (persists across think cycles, capped at 20)
    public conversationHistory: ConversationMessage[] = [];

    // Short-term memory buffer
    public memories: MemoryEntry[] = [];

    // Current assigned task (first in queue)
    public currentTask: string = '';

    // Sequential task queue (FIFO)
    public taskQueue: QueuedTask[] = [];

    constructor(config: AgentConfig) {
        this.config = config;
    }

    setInferenceAdapter(adapter: InferenceAdapter) {
        this.adapter = adapter;
    }

    async initialize(): Promise<void> {
        this.status = 'IDLE';
    }

    // --- Conversation System ---

    receiveMessage(msg: ConversationMessage) {
        this.inbox.push(msg);
        this.conversationHistory.push(msg);
        // Keep inbox at manageable size
        if (this.inbox.length > 20) this.inbox.shift();
        // Cap conversation history
        if (this.conversationHistory.length > 20) this.conversationHistory.shift();
    }

    /** Record a message this agent sent (for conversation history) */
    recordSentMessage(msg: ConversationMessage) {
        this.conversationHistory.push(msg);
        if (this.conversationHistory.length > 20) this.conversationHistory.shift();
    }

    getUnreadMessages(): ConversationMessage[] {
        return [...this.inbox];
    }

    clearInbox() {
        this.inbox = [];
    }

    // --- Task Queue ---

    /** Add a task to the queue. If no current task, promote immediately. */
    enqueueTask(title: string, timestamp: string) {
        this.taskQueue.push({ title, assignedAt: timestamp });
        if (!this.currentTask) {
            this.promoteNextTask();
        }
    }

    /** Shift queue: mark current done, promote next (or go idle). */
    completeCurrentTask(): string | null {
        const completed = this.currentTask;
        this.currentTask = '';
        this.promoteNextTask();
        return completed || null;
    }

    private promoteNextTask() {
        if (this.taskQueue.length > 0) {
            const next = this.taskQueue.shift()!;
            this.currentTask = next.title;
        }
    }

    // --- Memory System ---

    addMemory(entry: MemoryEntry) {
        this.memories.push(entry);
        // Trim low-importance memories when buffer exceeds limit
        const limit = this.config.memory.shortTermLimit || 50;
        if (this.memories.length > limit) {
            this.memories.sort((a, b) => b.importance - a.importance);
            this.memories = this.memories.slice(0, limit);
        }
    }

    getRecentMemories(count: number = 10): string[] {
        return this.memories.slice(-count).map(m => `[${m.type}] ${m.content}`);
    }

    loadMemories(entries: MemoryEntry[]) {
        this.memories = entries;
    }

    // --- Core Think Cycle ---

    async think(perception: Perception): Promise<Decision> {
        this.status = 'THINKING';

        if (!this.adapter) {
            console.warn(`[Agent ${this.config.name}] No InferenceAdapter set, mocking thought...`);
            return { thought: "Waiting for inference adapter...", action: "idle" };
        }

        try {
            // ─── SYSTEM MESSAGE: role, rules, capabilities ───
            const capList = this.config.capabilities.length > 0
                ? this.config.capabilities.map(c => `- ${c.name}: ${c.description}`).join('\n')
                : '- (no tools assigned)';

            const systemPrompt = `You are ${this.config.name}, ${this.config.role} at a startup called AI Business Builder HQ.

${this.config.inference.systemPrompt}

PERSONALITY: ${this.config.personality.communicationStyle} communication style.

YOUR TOOLS:
${capList}

DECISION RULES (follow strictly in this priority order):
1. If you have unread messages, you MUST respond (action: talk). Messages from "User" are TOP PRIORITY — always reply to User before replying to colleagues. Set target to the EXACT sender name.
2. If you have a REVIEW TASK, review it and complete the review (action: complete_task with your review verdict in "message"). Include "APPROVED" or "REVISE: <reason>" in your message.
3. If you have a current task, work on it using the appropriate action for the current stage.
4. If you have NO tasks and fewer than 3 active tasks, PROPOSE a new task (action: propose_task, put the task title in "message").
5. If no task and no messages, stay idle at your desk (action: idle).
6. Do NOT wander, explore, or start unsolicited conversations when idle.
7. When talking, ALWAYS set "target" to the exact name of the person you are replying to.
8. When using a tool, set "toolCall" with name and params.
9. Keep thoughts under 15 words.

TASK STAGES: proposed → planned → implementing → reviewing → done.
- complete_task advances to the NEXT stage, not straight to done.
- Work on a task for at least 2 cycles before completing the stage.
- If you have NO tasks, use propose_task with the task title in "message".

RESPOND WITH ONLY this JSON (no other text):
{"thought":"...","action":"work|talk|idle|use_tool|complete_task|propose_task","target":"name or empty","message":"what you say","toolCall":{"name":"tool","params":{}}}`;

            // ─── USER MESSAGE: current situation ───
            const nearbyStr = perception.nearbyAgents.length > 0
                ? perception.nearbyAgents.map(a => `${a.name} (${a.role}) - ${a.distance} tiles away`).join('\n')
                : 'Nobody nearby.';

            // When User messages exist, ONLY show User messages (agent msgs distract the LLM)
            const hasUserMessage = perception.recentMessages.some(m => m.from === 'User');
            const visibleMessages = hasUserMessage
                ? perception.recentMessages.filter(m => m.from === 'User')
                : perception.recentMessages;
            const messageStr = visibleMessages.length > 0
                ? visibleMessages.map(m => `${m.from}: "${m.content}"`).join('\n')
                : 'None';

            const historyStr = this.conversationHistory.length > 0
                ? this.conversationHistory.slice(-8).map(m => `${m.from} → ${m.to}: "${m.content}"`).join('\n')
                : 'None';

            const memoryStr = perception.memories.length > 0
                ? perception.memories.slice(-5).join('\n')
                : 'None';

            const taskStr = this.currentTask || 'None assigned';
            const queueCount = this.taskQueue.length;
            const stageStr = perception.taskStage ? ` [Stage: ${perception.taskStage.toUpperCase()}]` : '';
            const activeCount = perception.activeTaskCount ?? 0;

            let reviewStr = '';
            if (perception.reviewTask) {
                reviewStr = `\nREVIEW TASK: You need to review "${perception.reviewTask.title}" by ${perception.reviewTask.author}.\nDeliverable: ${perception.reviewTask.deliverable || '(no deliverable yet)'}\nRespond with complete_task and include "APPROVED" or "REVISE: <reason>" in your message.`;
            }

            let proposeHint = '';
            if (!this.currentTask && activeCount < 3 && !perception.reviewTask) {
                proposeHint = '\nYou have no current task. PROPOSE a new task relevant to your role using action: propose_task.';
            }

            const userPriority = hasUserMessage
                ? `\n\n>>> URGENT: You have a message from User! You MUST respond NOW. Use action "talk" with target "User". This overrides ALL other priorities. <<<`
                : '';

            const userPrompt = `CURRENT SITUATION:
Time: ${perception.time}
Location: ${perception.location}

NEARBY COLLEAGUES:
${nearbyStr}

YOUR CURRENT TASK: ${taskStr}${stageStr}${queueCount > 0 ? `\nQUEUED TASKS: ${queueCount} more waiting` : ''}
ACTIVE TASKS: ${activeCount}/3${reviewStr}${proposeHint}

UNREAD MESSAGES:
${messageStr}${userPriority}

RECENT CONVERSATION HISTORY:
${historyStr}

RECENT MEMORIES:
${memoryStr}

What do you do next?`;

            const temperature = this.config.inference.temperature ?? 0.7;

            const res = await this.adapter.complete({
                model: this.config.inference.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature,
                maxTokens: 300
            });

            // ─── ROBUST JSON EXTRACTION ───
            // Find first balanced {...} respecting strings (handles LLM junk around the JSON)
            const jsonStr = this.extractBalancedJSON(res.content);

            let parsed: any = null;
            if (jsonStr) {
                // Try direct parse
                try { parsed = JSON.parse(jsonStr); } catch {
                    // Try cleaning common LLM mistakes: trailing commas, control chars
                    try {
                        const cleaned = jsonStr
                            .replace(/[\x00-\x1f\x7f]/g, ' ')
                            .replace(/,(\s*[}\]])/g, '$1');
                        parsed = JSON.parse(cleaned);
                    } catch (e2) {
                        console.warn(`[Agent ${this.config.name}] JSON parse failed. Raw LLM output: ${res.content.slice(0, 300)}`);
                    }
                }
            }

            if (parsed) {
                const decision: Decision = {
                    thought: (parsed.thought || "Thinking...").slice(0, 120),
                    action: parsed.action || "idle",
                    target: parsed.target,
                    message: parsed.message,
                    toolCall: parsed.toolCall
                };

                // Auto-remember this thought
                this.addMemory({
                    content: decision.thought,
                    type: 'thought',
                    timestamp: perception.time,
                    importance: 0.3
                });

                // ─── TASK COMPLETION via explicit action ───
                if (decision.action === 'complete_task') {
                    const completed = this.completeCurrentTask();
                    if (completed) {
                        this.addMemory({
                            content: `Completed task: "${completed}" — ${decision.message || 'done'}`,
                            type: 'achievement',
                            timestamp: perception.time,
                            importance: 0.8
                        });
                    }
                }

                // If user message pending: force talk + ensure message is never empty
                if (hasUserMessage) {
                    if (decision.action !== 'talk') {
                        console.warn(`[Agent ${this.config.name}] Had user message but chose "${decision.action}" — forcing talk`);
                    }
                    decision.action = 'talk';
                    decision.target = 'User';
                    if (!decision.message) {
                        decision.message = decision.thought || "I'm here. How can I help?";
                    }
                }

                return decision;
            }

            // No valid JSON — if user was waiting, extract any usable text as a response
            if (hasUserMessage && res.content.trim()) {
                console.warn(`[Agent ${this.config.name}] No valid JSON but user message pending — extracting raw response`);
                const rawText = res.content
                    .replace(/```[\s\S]*?```/g, '')
                    .replace(/\{[\s\S]*$/g, '')  // remove partial JSON
                    .trim().slice(0, 200);
                return {
                    thought: "Responding to user (raw)",
                    action: "talk",
                    target: "User",
                    message: rawText || "I received your message. Let me think about that."
                };
            }
        } catch (e) {
            console.error(`[Agent ${this.config.name}] Inference failed:`, e);
        }

        return { thought: "Systems recovering...", action: "idle" };
    }

    /** Extract first balanced {...} from LLM output, respecting quoted strings */
    private extractBalancedJSON(text: string): string | null {
        let depth = 0;
        let start = -1;
        let inString = false;
        let escape = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;

            if (ch === '{') {
                if (start === -1) start = i;
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0 && start !== -1) {
                    return text.slice(start, i + 1);
                }
            }
        }
        return null;
    }

    async act(decision: Decision): Promise<ActionResult> {
        this.status = 'ACTING';
        return { success: true };
    }

    async remember(event: Event): Promise<void> {
        this.addMemory({
            content: `${event.type}: ${JSON.stringify(event.data)}`,
            type: 'observation',
            timestamp: event.timestamp.toISOString(),
            importance: 0.5
        });
    }

    async communicate(message: Message): Promise<void> {
        this.status = 'COMMUNICATING';
        this.addMemory({
            content: `${message.from} said: "${message.content}"`,
            type: 'conversation',
            timestamp: new Date().toISOString(),
            importance: 0.7
        });
    }
}
