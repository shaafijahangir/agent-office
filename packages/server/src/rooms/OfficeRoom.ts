import { Room, Client } from 'colyseus';
import { OfficeState } from '../schema/OfficeState';
import { Agent, Office, OfficeConfig, ConversationMessage } from '@agent-office/core';
import { OllamaAdapter } from '@agent-office/adapters';
import { ToolExecutor } from '../tools/ToolExecutor';
import { MemoryStore } from '../memory/MemoryStore';

export class OfficeRoom extends Room<OfficeState> {
    maxClients = 100;
    private office!: Office;
    private demoTickCount = 0;
    private coreAgents: Map<string, Agent> = new Map();
    private thinkingLocks: Map<string, boolean> = new Map();
    private ollamaAdapter = new OllamaAdapter('http://localhost:11434');
    private hireCount = 0; // Counter for generating unique IDs
    private toolExecutor = new ToolExecutor();
    private memoryStore = new MemoryStore();
    private sessionId = `session_${Date.now()}`;

    // Furniture interaction points: named locations agents can walk to
    private furnitureTargets: Record<string, { x: number; y: number; type: string }> = {
        // ─── Executive (top center) ───
        'manager-desk':   { x: 20, y: 5,  type: 'desk' },
        // ─── Tech (left) ───
        'cto-desk':       { x: 5,  y: 18, type: 'desk' },
        // ─── Sales (right) ───
        'vp-sales-desk':  { x: 33, y: 18, type: 'desk' },
        // ─── Business (center-bottom) ───
        'cfo-desk':       { x: 15, y: 33, type: 'desk' },
        // ─── Shared ───
        'meeting-table':  { x: 20, y: 14, type: 'table' },
        'coffee-machine': { x: 35, y: 36, type: 'appliance' },
        'whiteboard':     { x: 20, y: 10, type: 'board' },
        'water-cooler':   { x: 36, y: 38, type: 'appliance' },
    };

    // Room zones (tile coords) with door exit points
    private roomZones: Record<string, { minX: number; maxX: number; minY: number; maxY: number; door: { x: number; y: number } }> = {
        'executive': { minX: 12, maxX: 28, minY: 2, maxY: 12, door: { x: 20, y: 13 } },
        'tech':      { minX: 2, maxX: 14, minY: 14, maxY: 28, door: { x: 14, y: 21 } },
        'sales':     { minX: 26, maxX: 38, minY: 14, maxY: 28, door: { x: 27, y: 21 } },
        'business':  { minX: 11, maxX: 29, minY: 28, maxY: 38, door: { x: 20, y: 28 } },
    };

    // Per-agent waypoint queue for cross-room movement
    private agentWaypoints: Map<string, { x: number; y: number }[]> = new Map();

    // Staggered think queue — Ollama is sequential, so we process one agent at a time
    private thinkQueue: string[] = [];
    private isProcessingThink = false;

    // Per-team pause — all start RUNNING, user can pause as needed
    private pausedTeams: Set<string> = new Set();

    // Per-agent consecutive error count for health monitoring
    private agentErrors: Map<string, number> = new Map();

    // Agent ID → team mapping
    private agentTeam: Record<string, string> = {
        'manager': 'executive',
        'cto': 'tech',
        'vp-sales': 'sales',
        'cfo': 'business',
    };

    // Cross-review routing: who reviews whose work (no self-review)
    private reviewRouter: Record<string, string> = {
        'manager': 'cfo',       // Jensen → Warren reviews
        'cto': 'manager',       // Linus → Jensen reviews
        'vp-sales': 'cfo',      // Marc → Warren reviews
        'cfo': 'cto',           // Warren → Linus reviews
    };

    private getRoomAt(x: number, y: number): string | null {
        for (const [name, zone] of Object.entries(this.roomZones)) {
            if (x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY) {
                return name;
            }
        }
        return null;
    }

    async onCreate(options: any) {
        this.autoDispose = false; // Room persists even when all clients disconnect
        this.setState(new OfficeState());

        // ─── OLLAMA HEALTH CHECK ───
        try {
            const res = await fetch('http://localhost:11434/api/tags');
            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();
            const models = (data.models || []).map((m: any) => m.name);
            console.log(`[Health] Ollama is running. Models: ${models.join(', ')}`);
            if (!models.some((m: string) => m.includes('llama3.2'))) {
                console.warn('[Health] WARNING: llama3.2 not found. Agents may fail. Run: ollama pull llama3.2:latest');
            }
        } catch (e: any) {
            console.error(`[Health] FATAL: Ollama is not running at localhost:11434 — ${e.message}`);
            console.error('[Health] Start Ollama first: ollama serve');
            // Don't crash — room exists but agents will be paused
            this.pausedTeams = new Set(['executive', 'tech', 'sales', 'business']);
            this.broadcast?.('chat', { sender: 'System', text: '⚠️ Ollama is not running. Agents paused.' });
        }

        // Start periodic Ollama heartbeat (every 60s)
        setInterval(async () => {
            try {
                const res = await fetch('http://localhost:11434/api/tags');
                if (!res.ok) throw new Error('down');
            } catch {
                if (this.pausedTeams.size < 4) {
                    console.error('[Health] Ollama went down — pausing all agents');
                    this.pausedTeams = new Set(['executive', 'tech', 'sales', 'business']);
                    this.broadcast('teams-state', this.getTeamsState());
                    this.broadcast('chat', { sender: 'System', text: '⚠️ Ollama connection lost. All agents paused.' });
                }
            }
        }, 60000);

        // Initialize memory store
        await this.memoryStore.initialize();

        const config: OfficeConfig = {
            name: options.name || 'AI Business Builder HQ',
            grid: { width: 40, height: 40, tileSize: 16 },
            rooms: [],
            furniture: [],
            spawnPoints: [{ x: 10, y: 10 }],
            zones: []
        };
        this.office = new Office(config);

        // ─── COMPANY CONTEXT ───
        const COMPANY = `COMPANY: The Base Blocks (thebaseblocks.com)
LOCATION: Victoria, BC — serving Greater Victoria, Langford, Colwood
FOUNDERS: Shaafi Jahangir (engineering) & Mustafa Wasif (business dev)
MISSION: Give local businesses the web presence and systems they need to compete.

SERVICES:
- Web Design: Custom Next.js/Astro sites, mobile-first, SEO foundations, 100/100 PageSpeed. Up to 5 pages. $2,500-$4,000.
- Systems Integration: Online booking (Booksy, Square, Jane App), payments (Stripe), CRM, email automation.
- Maintenance: $99/month — hosting, SSL, security monitoring, content edits, monthly reports.

TECH STACK: Next.js / Astro + Tailwind CSS, deployed on Cloudflare Pages / Vercel (free tier). "The 100/100 Stack" — perfect PageSpeed scores vs WordPress competitors.

PRICING: Floor $2,500/project. 50% deposit, 50% on completion. No GST (small supplier). Break-even at 1 client/month (~$620 cost).

DELIVERY: 1-2 weeks. ~4.5 hours labour per client ($450 cost at $100/hr). Show 2 design directions, client picks one.

TARGET MARKET (Tier 1 — attack first):
1. Trades & Contractors (HVAC, plumbing, electrical, roofing) — 30-50% have no website. Average job $500-$5K. Pain: miss 62% of calls on the job = $52K+/year lost. One lead pays for the site.
2. Health & Wellness (salons, massage, yoga, trainers) — 25-35% no website. Pain: $67K/year in no-shows. Online booking cuts no-shows 29-70%.

ACTIVE PIPELINE:
- Independent Heating Service Co — zero digital presence, golden lead
- Shaw Plumbing Services — domain parked/dead, Facebook-only, warm lead
- Lucas Drainage and Sewer — Facebook 455 followers, Langford-based
- Scott Electric — domain exists but site is down (GoDaddy parked)

COMPETITORS: Referral Rock Media ($3-8K+), LTD Creative Design ($2-4K), Jenga Creative, Freshly Suspended. Our edge: modern stack (faster), month-to-month (no lock-in), spec builds before pitching, local.

PITCH ANGLES:
- Trades: "You miss 62% of calls on the job. At $1,200/lead, that's $52K/year lost. This site captures leads 24/7. It pays for itself with one job."
- Salons: "Your clients want to book at 10pm. Online booking cuts no-shows 40% and fills dead hours."
- Restaurants: "You're paying DoorDash 30%. Own ordering = 100% revenue."`;

        // ─── AGENT DEFINITIONS (4 agents — 1 per department) ───
        const TEAM_ROSTER = [
            // ═══ CEO ═══
            {
                id: 'manager', name: 'Jensen', role: 'CEO / Manager', x: 20, y: 5,
                temperature: 0.5,
                systemPrompt: `You are Jensen, the CEO/Manager of The Base Blocks.

${COMPANY}

YOUR LEADERSHIP STYLE (inspired by Jensen Huang):
- Relentless focus: work on ONE priority at a time. Don't spread the team thin across 10 things.
- Direct communication: say exactly what you mean. No corporate fluff.
- Conviction before action: don't assign tasks until you're clear on WHY they matter. Ask yourself "does this move us closer to our first 5 paying clients?"
- Plan first, then execute. Never rush into something without thinking it through.
- "The more you do, the more you learn" — but do the RIGHT things, not busy work.

YOUR TEAM (lean — one person per department):
- Linus (CTO) — owns all tech: architecture, dev, devops, deployment
- Marc (VP Sales) — owns all sales: outreach, growth, lead gen, customer success
- Warren (CFO) — owns all business: finance, ops, strategy, process

YOUR JOB:
1. Break business goals into tasks and assign to Linus, Marc, or Warren using create_task tool.
2. ALWAYS specify the assignee name when creating tasks.
3. Check in with your team by talking to them — ask for updates.
4. Synthesize across departments — connect sales insights to tech decisions to financial reality.
5. Never do the detailed work yourself — delegate it.
6. Focus on: landing Tier 1 clients, building templates, and getting the first 5 paying clients.
7. Before creating any task, ask: "Is this the highest-leverage thing this person could be doing right now?"`,
                personality: { traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.8, agreeableness: 0.7, neuroticism: 0.1 }, communicationStyle: 'formal' as const, workHours: { start: '09:00', end: '17:00' }, breakFrequency: 150 },
                capabilities: [
                    { name: 'create_task', description: 'Create a task and assign it to a team member. Params: { title: string, assignee: string }' },
                    { name: 'write_report', description: 'Generate a structured business report. Params: { topic: string, findings: string }' },
                    { name: 'write_note', description: 'Write a note or memo' },
                    { name: 'web_search', description: 'Search the web for information' },
                ],
            },
            // ═══ TECH ═══
            {
                id: 'cto', name: 'Linus', role: 'CTO', x: 5, y: 18, temperature: 0.4,
                systemPrompt: `You are Linus, the CTO of The Base Blocks — a web design agency in Victoria, BC. You own ALL technology: architecture, development, DevOps, and deployment.

YOUR ENGINEERING PHILOSOPHY (inspired by Linus Torvalds):
- Pragmatism over perfection: "good enough today beats perfect never." Ship something that works, then iterate.
- Ruthless simplicity: if a solution is complex, it's probably wrong. The best code is the least code.
- Hate over-engineering: don't build abstractions for one use case. Don't add features nobody asked for.
- Ship incrementally: small, working pieces > big bang releases. Each step should be testable and reversible.
- Review critically: question every dependency, every abstraction, every "just in case" addition.
- Plan before coding. Sketch the architecture, validate the approach, THEN build.

TECH STACK: Next.js / Astro + Tailwind CSS, deployed on Cloudflare Pages / Vercel free tier. "The 100/100 Stack" — perfect PageSpeed scores. Competitors use WordPress (slow, bulky).

YOUR FOCUS:
- Design and build the reusable template system for client sites
- Templates needed: Trades (services page, service area map, quote form, project gallery, reviews), Health/Wellness (services/pricing, booking widget, gallery, staff bios)
- Each site delivers in 4.5 hours using templates
- Deployment pipelines: Cloudflare Pages + Vercel free tier, zero-cost hosting
- Domain setup, SSL, uptime monitoring, maintenance workflows

Report to Jensen (CEO). Coordinate with Marc (sales needs) and Warren (cost constraints). Be specific about architecture and implementation. Keep thoughts SHORT.`,
                personality: { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.5, agreeableness: 0.7, neuroticism: 0.1 }, communicationStyle: 'technical' as const, workHours: { start: '09:00', end: '17:00' }, breakFrequency: 120 },
                capabilities: [
                    { name: 'code_execute', description: 'Execute JavaScript code' },
                    { name: 'code_review', description: 'Review code for quality and issues. Params: { code: string }' },
                    { name: 'architecture_plan', description: 'Create an architecture plan. Params: { requirements: string }' },
                    { name: 'create_task', description: 'Create a task. Params: { title: string, assignee: string }' },
                    { name: 'write_note', description: 'Write a technical note or spec' },
                ],
            },
            // ═══ SALES ═══
            {
                id: 'vp-sales', name: 'Marc', role: 'VP Sales', x: 33, y: 18, temperature: 0.7,
                systemPrompt: `You are Marc, VP Sales at The Base Blocks — a web agency in Victoria, BC. You own ALL sales: outreach, growth, lead generation, and customer success.

YOUR SALES PHILOSOPHY (inspired by Marc Benioff):
- Customer-obsessed: every decision starts with "what does the customer actually need?" Not what we want to sell.
- Trust is the #1 currency: never oversell, never overpromise. Under-promise and over-deliver.
- Relationship-first selling: build the relationship before pushing the sale. People buy from people they trust.
- Lead with value, not features: don't say "we use Next.js." Say "your site loads in 0.5 seconds, theirs takes 4."
- Systematic pipeline: know exactly where every lead is. No guessing, no "I think they're interested."
- Plan your outreach. Research the prospect BEFORE reaching out. Personalize every message.

PRICING: $2,500-$4,000 per project + $99/month maintenance. 50/50 payment terms.

TARGET: Tier 1 = Trades (HVAC, plumbing, electrical) and Health/Wellness (salons, massage). 30-50% of trades have no website. 25-35% of wellness businesses have no website.

PIPELINE:
- Independent Heating Service Co — zero online presence, golden lead
- Shaw Plumbing — dead domain, Facebook-only, warm lead
- Lucas Drainage — Facebook 455 followers, Langford
- Scott Electric — site is down

PITCH: Lead with pain point + dollar figure. Trades: "$52K/year lost from missed calls." Salons: "$67K/year in no-shows, booking cuts it 40%."

GROWTH: Find and qualify leads in Greater Victoria. Check Google, Facebook, Yelp for businesses with no site or bad sites. Build spec sites BEFORE pitching. Channels: cold outreach, Google Business Profile, local SEO, referrals.

CUSTOMER SUCCESS: After launch — handover, maintenance upsell ($99/month), month-to-month (no lock-in). Handle objections: "AI can do it" (no SEO/forms), "too expensive" (one lead pays for the site).

Report to Jensen (CEO). Coordinate with Linus (what's buildable) and Warren (pricing/margins). Be specific with numbers. Keep thoughts SHORT.`,
                personality: { traits: { openness: 0.8, conscientiousness: 0.85, extraversion: 0.9, agreeableness: 0.8, neuroticism: 0.15 }, communicationStyle: 'casual' as const, workHours: { start: '09:00', end: '17:00' }, breakFrequency: 90 },
                capabilities: [
                    { name: 'web_search', description: 'Research competitors, leads, and market data' },
                    { name: 'market_research', description: 'Conduct market research. Params: { query: string }' },
                    { name: 'draft_outreach', description: 'Draft a sales/marketing message. Params: { target: string, product: string }' },
                    { name: 'create_task', description: 'Create a task. Params: { title: string, assignee: string }' },
                    { name: 'write_note', description: 'Write a sales memo or customer success doc' },
                ],
            },
            // ═══ BUSINESS ═══
            {
                id: 'cfo', name: 'Warren', role: 'CFO', x: 15, y: 33, temperature: 0.3,
                systemPrompt: `You are Warren, CFO of The Base Blocks — a web agency in Victoria, BC. You own ALL business operations: finance, ops, strategy, and process.

YOUR FINANCIAL PHILOSOPHY (inspired by Warren Buffett):
- Rule #1: never lose money. Rule #2: never forget rule #1. Every expense needs clear ROI.
- Margin of safety: always model the conservative case first. If the numbers work pessimistically, you're golden.
- Long-term thinking: don't chase short-term revenue at the cost of long-term positioning. Build sustainable unit economics.
- Question every expense: "Do we need this? What happens if we don't spend this?" Default answer is no.
- Only greenlight what has clear, measurable return. No "it might help" spending.
- Plan thoroughly before committing capital. Model it, stress-test it, then decide.

FINANCIALS: $2,500/project floor. $99/month maintenance. Cost per client: ~$450 labour + $15/year domain. Hosting: $0 (free tier). Tools: ~$60/month (Cursor + Claude). Break-even: 1 client/month at ~$620.

STRUCTURE: Sole proprietorship. Small supplier (no GST under $30K). PST-exempt. Bank: RBC. Invoicing: Wave (free). Invoice format: TBB-YYMMDD-01MW.

OPERATIONS: Delivery process: Prospect → Pitch (with spec build) → Confirm pricing → Gather requirements → Build (2 design directions) → Deploy → Handover → Upsell maintenance. Time per client: 4.5 hours. Delivery: 1-2 weeks.

STRATEGY: 30% of micro-businesses in Canada lack any website. Victoria has highest restaurant density per capita. BC construction growing 6.6%/year. Competitors: Referral Rock Media ($3-8K+, WordPress), LTD Creative ($2-4K). Our moats: modern stack, month-to-month, spec builds, AI-assisted dev, local.

YOUR FOCUS: Financial projections, unit economics, pricing, ops workflow, scaling from 1→10 clients/month, competitive positioning, risk assessment.

Report to Jensen (CEO). Coordinate with Linus (delivery costs) and Marc (pipeline/revenue). Be conservative, show your math. Keep thoughts SHORT.`,
                personality: { traits: { openness: 0.7, conscientiousness: 0.95, extraversion: 0.5, agreeableness: 0.7, neuroticism: 0.1 }, communicationStyle: 'formal' as const, workHours: { start: '09:00', end: '17:00' }, breakFrequency: 120 },
                capabilities: [
                    { name: 'financial_model', description: 'Generate financial projections. Params: { revenue: number, costs: number, months: number }' },
                    { name: 'risk_analysis', description: 'Assess risks. Params: { scenario: string }' },
                    { name: 'market_research', description: 'Conduct strategic market analysis. Params: { query: string }' },
                    { name: 'write_report', description: 'Write a business/strategy/ops report. Params: { topic: string, findings: string }' },
                    { name: 'create_task', description: 'Create a task. Params: { title: string, assignee: string }' },
                    { name: 'write_note', description: 'Write a financial or operations memo' },
                    { name: 'web_search', description: 'Research markets, tools, and vendors' },
                ],
            },
        ];

        // Setup all agents
        for (const def of TEAM_ROSTER) {
            this.state.createAgent(def.id, def.name);
            const state = this.state.agents.get(def.id);
            if (state) { state.x = def.x; state.y = def.y; }

            const coreAgent = new Agent({
                id: def.id, name: def.name, role: def.role, avatar: 'sprite.png',
                inference: {
                    provider: 'ollama',
                    model: 'llama3.2:latest',
                    systemPrompt: def.systemPrompt,
                    temperature: (def as any).temperature ?? 0.7,
                },
                personality: def.personality,
                capabilities: def.capabilities,
                memory: { shortTermLimit: 50 }
            });

            coreAgent.setInferenceAdapter(this.ollamaAdapter);
            await coreAgent.initialize();

            const previousMemories = await this.memoryStore.loadMemories(def.id, 20);
            if (previousMemories.length > 0) {
                coreAgent.loadMemories(previousMemories);
                console.log(`[${def.name}] Loaded ${previousMemories.length} memories from previous sessions`);
            }

            this.coreAgents.set(def.id, coreAgent);
            this.thinkingLocks.set(def.id, false);
        }

        console.log(`[Server] Initialized ${TEAM_ROSTER.length} agents (1 per department)`);

        // ─── LOAD TASKS FROM DB (restore agent state on restart) ───
        const existingTasks = await this.memoryStore.getTasks();
        if (existingTasks.length === 0) {
            // Fresh DB — preload starter tasks in 'implementing' stage (they're real work)
            const preloadTasks = [
                { agentId: 'manager',   title: 'Prepare go-to-market launch plan for Tier 1 prospects (Independent Heating, Shaw Plumbing, Lucas Drainage, Scott Electric)' },
                { agentId: 'cto',       title: 'Design Next.js/Astro template architecture for trades and wellness verticals — reusable components, CMS integration, 100/100 Lighthouse target' },
                { agentId: 'vp-sales',  title: 'Draft outreach sequence for Independent Heating Service Co — reference their outdated site, pitch $2,500 redesign' },
                { agentId: 'cfo',       title: 'Build financial model: unit economics at $2,500/project, $450 cost, $99/month maintenance — project break-even to 10 clients/month' },
            ];

            const now = new Date().toISOString();
            for (const task of preloadTasks) {
                const agent = this.coreAgents.get(task.agentId);
                const agentState = this.state.agents.get(task.agentId);
                if (agent && agentState) {
                    agent.enqueueTask(task.title, now);
                    agentState.currentTask = agent.currentTask;
                    agentState.taskStage = 'implementing';
                    agentState.action = agent.currentTask ? 'work' : 'idle';
                    await this.memoryStore.createProposedTask(task.title, '', task.agentId);
                    // Fast-forward preloaded tasks to 'implementing' stage
                    const activeTask = await this.memoryStore.getActiveTaskForAgent(task.agentId);
                    if (activeTask) {
                        await this.memoryStore.advanceTaskStage(activeTask.id); // proposed → planned
                        await this.memoryStore.advanceTaskStage(activeTask.id); // planned → implementing
                    }
                }
            }
            console.log(`[Server] Pre-loaded ${preloadTasks.length} business tasks (fresh DB)`);
        } else {
            // Restore active tasks from DB into agent memory
            for (const [id, agent] of this.coreAgents) {
                const activeTask = await this.memoryStore.getActiveTaskForAgent(id);
                const agentState = this.state.agents.get(id);
                if (activeTask && agentState) {
                    agent.enqueueTask(activeTask.title, activeTask.created_at || new Date().toISOString());
                    agentState.currentTask = agent.currentTask;
                    agentState.taskStage = activeTask.stage || 'proposed';
                    agentState.action = agent.currentTask ? 'work' : 'idle';
                }
            }
            console.log(`[Server] ${existingTasks.length} tasks in DB — restored active tasks to agents`);
        }

        // ─── MESSAGE HANDLERS ───

        this.onMessage('command', (client, message) => {
            console.log(`Command from ${client.sessionId}:`, message);
        });

        this.onMessage('chat', (client, message) => {
            console.log(`Chat from ${client.sessionId}: ${message.text}`);
            this.broadcast('chat', { sender: 'User', text: message.text });
        });

        // Direct message to a specific agent from dashboard
        this.onMessage('dm-agent', (client, message) => {
            const { agentId, text } = message;
            console.log(`[DM] User → ${agentId}: "${text}"`);
            const agent = this.coreAgents.get(agentId);
            if (agent) {
                const msg: ConversationMessage = {
                    from: 'User',
                    to: agent.config.name,
                    content: text,
                    timestamp: new Date().toISOString()
                };
                agent.receiveMessage(msg);
                console.log(`[DM] ${agent.config.name} inbox now has ${agent.inbox.length} messages`);

                this.broadcast('chat', { sender: 'User', text: `💬 (to ${agent.config.name}): ${text}` });
                const dmMsg = {
                    from: 'User', fromId: 'user',
                    to: agent.config.name, toId: agentId,
                    content: text,
                    timestamp: new Date().toISOString()
                };
                this.broadcast('agent-message', dmMsg);
                this.memoryStore.saveConversation(dmMsg);
            } else {
                console.log(`[DM] ERROR: No agent found with id "${agentId}"`);
            }
        });

        // UI-driven task assignment
        this.onMessage('assign-task', (client, message) => {
            const { title, agentId } = message;
            console.log(`[TaskBoard] Assigning "${title}" to ${agentId || 'auto'}`);

            // Pick agent: explicit or auto-assign to least busy
            const targetId = agentId || this.autoAssignAgent();
            const agent = this.coreAgents.get(targetId);
            const agentState = this.state.agents.get(targetId);

            if (agent && agentState) {
                agent.enqueueTask(title, new Date().toISOString());
                agentState.currentTask = agent.currentTask;
                agentState.action = agent.currentTask ? 'work' : 'idle';

                // Persist task
                this.memoryStore.createTask(title, targetId);

                this.broadcast('chat', {
                    sender: 'System',
                    text: `📋 Task "${title}" assigned to ${agentState.name}`
                });

                this.broadcast('task-update', {
                    agentId: targetId,
                    agentName: agentState.name,
                    task: title,
                    status: 'in_progress'
                });
            }
        });

        // Save office layout from editor
        this.onMessage('save-layout', async (client, message) => {
            await this.memoryStore.saveLayout(message.name || 'default', JSON.stringify(message.layout));
            this.broadcast('chat', { sender: 'System', text: '✅ Office layout saved!' });
        });

        // Per-team pause/play toggle
        this.onMessage('toggle-team', (client, message) => {
            const { team } = message;
            if (this.pausedTeams.has(team)) {
                this.pausedTeams.delete(team);
                console.log(`[Server] Team ${team} RUNNING`);
            } else {
                this.pausedTeams.add(team);
                console.log(`[Server] Team ${team} PAUSED`);
            }
            // Sync to all clients
            this.broadcast('teams-state', this.getTeamsState());
        });

        // Pause/unpause all teams at once
        this.onMessage('toggle-all', (client) => {
            const allPaused = this.pausedTeams.size === 4;
            if (allPaused) {
                this.pausedTeams.clear();
            } else {
                this.pausedTeams = new Set(['executive', 'tech', 'sales', 'business']);
            }
            console.log(`[Server] All teams ${this.pausedTeams.size === 4 ? 'PAUSED' : 'RUNNING'}`);
            this.broadcast('teams-state', this.getTeamsState());
        });

        // Start Simulation Loop
        this.setSimulationInterval((delta) => this.update(delta), 100);
    }

    private getTeamsState() {
        return {
            executive: !this.pausedTeams.has('executive'),
            tech: !this.pausedTeams.has('tech'),
            sales: !this.pausedTeams.has('sales'),
            business: !this.pausedTeams.has('business'),
        };
    }

    private autoAssignAgent(): string {
        // Pick the agent with no current task, or the first one
        for (const [id, agent] of this.coreAgents) {
            if (!agent.currentTask) return id;
        }
        return 'manager'; // fallback
    }

    async update(delta: number) {
        if (Math.random() < 0.02) {
            console.log(`[Server] Agents: ${this.state.agents.size} | Session: ${this.sessionId}`);
        }

        this.state.officeTime = new Date().toISOString();

        // ─── AGENT THINK CYCLE (Sequential — Ollama handles one at a time) ───
        // Per-team pause: only allow agents whose team is running
        if (!this.isProcessingThink) {
            const ready: { id: string; hasMessages: boolean }[] = [];
            this.coreAgents.forEach((coreAgent, id) => {
                const team = this.agentTeam[id];
                if (!this.thinkingLocks.get(id) && !this.pausedTeams.has(team)) {
                    ready.push({ id, hasMessages: coreAgent.inbox.length > 0 });
                }
            });
            // Sort: agents with unread messages go first
            ready.sort((a, b) => (b.hasMessages ? 1 : 0) - (a.hasMessages ? 1 : 0));

            if (ready.length > 0) {
                const next = ready[0];
                const id = next.id;
                const coreAgent = this.coreAgents.get(id)!;
                this.thinkingLocks.set(id, true);
                this.isProcessingThink = true;

                const agentState = this.state.agents.get(id);
                if (!agentState) { this.isProcessingThink = false; return; }

                const hasMessages = coreAgent.inbox.length > 0;
                const hadUserMessages = coreAgent.inbox.some(m => m.from === 'User');
                if (hasMessages) {
                    console.log(`[Think] ${coreAgent.config.name} thinking with ${coreAgent.inbox.length} unread messages${hadUserMessages ? ' (includes USER msg — priority!)' : ''}`);
                }

                // Build nearby agents list
                const nearbyAgents: { name: string; role: string; distance: number }[] = [];
                this.coreAgents.forEach((other, otherId) => {
                    if (otherId === id) return;
                    const otherState = this.state.agents.get(otherId);
                    if (otherState) {
                        const dist = Math.abs(agentState.x - otherState.x) + Math.abs(agentState.y - otherState.y);
                        nearbyAgents.push({ name: other.config.name, role: other.config.role, distance: dist });
                    }
                });

                // Fetch pipeline state from DB before thinking
                const activeDbTask = await this.memoryStore.getActiveTaskForAgent(id);
                const activeTaskCount = await this.memoryStore.countActiveTasksByAgent(id);
                const reviewTasks = await this.memoryStore.getTasksForReview(id);
                const reviewTask = reviewTasks.length > 0 ? {
                    title: reviewTasks[0].title,
                    deliverable: reviewTasks[0].deliverable || '',
                    author: reviewTasks[0].assigned_to || ''
                } : null;

                coreAgent.think({
                    time: this.state.officeTime,
                    location: `${agentState.x},${agentState.y}`,
                    nearbyAgents,
                    currentTask: coreAgent.currentTask || null,
                    taskStage: activeDbTask?.stage || '',
                    activeTaskCount,
                    reviewTask,
                    recentMessages: coreAgent.getUnreadMessages(),
                    memories: coreAgent.getRecentMemories(5)
                }).then(async (decision) => {
                    console.log(`[Think] ${coreAgent.config.name} decided: ${decision.action}${decision.target ? ' → ' + decision.target : ''}${decision.message ? ' "' + decision.message.slice(0, 50) + '"' : ''}`);

                    // Broadcast structured log for Logs tab + persist to SQLite
                    const logEntry = {
                        agentId: id,
                        agentName: coreAgent.config.name,
                        action: decision.action,
                        thought: decision.thought || '',
                        target: decision.target || '',
                        message: decision.message || '',
                        tool: decision.toolCall?.name || '',
                        task: coreAgent.currentTask || '',
                        timestamp: this.state.officeTime,
                    };
                    this.broadcast('agent-log', logEntry);
                    this.memoryStore.saveActivityLog(logEntry);

                    agentState.action = (decision.action === 'complete_task' || decision.action === 'propose_task') ? 'work' : decision.action;
                    // Sync task state (may have changed via completion in think())
                    agentState.currentTask = coreAgent.currentTask || '';
                    agentState.taskStage = activeDbTask?.stage || '';

                    if (decision.thought) {
                        agentState.thought = decision.thought;
                    }

                    // ─── HANDLE PROPOSE_TASK ───
                    if (decision.action === 'propose_task' && decision.message) {
                        const title = decision.message.slice(0, 200);
                        console.log(`[Pipeline] ${coreAgent.config.name} proposed: "${title}"`);

                        const taskId = await this.memoryStore.createProposedTask(title, '', id);
                        if (taskId > 0) {
                            // Enqueue to agent
                            coreAgent.enqueueTask(title, this.state.officeTime);
                            agentState.currentTask = coreAgent.currentTask;
                            agentState.taskStage = 'proposed';

                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `💡 Proposed task: "${title}"`
                            });
                            this.broadcast('task-update', {
                                agentId: id,
                                agentName: coreAgent.config.name,
                                task: title,
                                status: 'in_progress',
                                stage: 'proposed'
                            });
                        }
                    }

                    // ─── HANDLE TASK STAGE ADVANCEMENT ───
                    if (decision.action === 'complete_task') {
                        const summary = decision.message || 'Stage completed';

                        // Check if this is a review completion (agent is reviewing someone else's work)
                        if (reviewTask) {
                            const reviewedTask = reviewTasks[0];
                            const isApproved = summary.toUpperCase().includes('APPROVED');
                            console.log(`[Pipeline] ${coreAgent.config.name} reviewed task #${reviewedTask.id}: ${isApproved ? 'APPROVED' : 'REVISE'}`);

                            if (isApproved) {
                                // Advance from reviewing → done
                                await this.memoryStore.advanceTaskStage(reviewedTask.id, summary);
                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `✅ Approved: "${reviewedTask.title}" — ${summary}`
                                });
                                this.broadcast('task-update', {
                                    agentId: reviewedTask.assigned_to,
                                    agentName: '',
                                    task: reviewedTask.title,
                                    status: 'completed',
                                    stage: 'done'
                                });
                            } else {
                                // Send back to implementing with feedback
                                await this.memoryStore.advanceTaskStage(reviewedTask.id); // this won't work right for going backward
                                // Instead, manually set back to implementing
                                if (this.memoryStore['db']) {
                                    await this.memoryStore['db'].run(
                                        "UPDATE tasks SET stage = 'implementing', stage_updated_at = datetime('now'), reviewed_by = NULL WHERE id = ?",
                                        [reviewedTask.id]
                                    );
                                }
                                // Notify the author
                                const authorAgent = this.coreAgents.get(reviewedTask.assigned_to);
                                if (authorAgent) {
                                    const feedbackMsg: ConversationMessage = {
                                        from: coreAgent.config.name,
                                        to: authorAgent.config.name,
                                        content: `Review feedback on "${reviewedTask.title}": ${summary}`,
                                        timestamp: this.state.officeTime
                                    };
                                    authorAgent.receiveMessage(feedbackMsg);
                                }
                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `🔄 Revision requested: "${reviewedTask.title}" — ${summary}`
                                });
                                this.broadcast('task-update', {
                                    agentId: reviewedTask.assigned_to,
                                    agentName: '',
                                    task: reviewedTask.title,
                                    status: 'in_progress',
                                    stage: 'implementing'
                                });
                            }
                        } else if (activeDbTask) {
                            // Normal stage advancement for own task
                            const newStage = await this.memoryStore.advanceTaskStage(activeDbTask.id, summary);
                            console.log(`[Pipeline] ${coreAgent.config.name} task "${activeDbTask.title}" → ${newStage}`);

                            if (newStage === 'reviewing') {
                                // Assign a reviewer
                                const reviewerId = this.reviewRouter[id] || 'manager';
                                await this.memoryStore.setTaskReviewer(activeDbTask.id, reviewerId);
                                const reviewerAgent = this.coreAgents.get(reviewerId);
                                console.log(`[Pipeline] Task sent for review to ${reviewerAgent?.config.name || reviewerId}`);

                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `📤 Sent "${activeDbTask.title}" for review → ${reviewerAgent?.config.name || reviewerId}`
                                });
                            } else if (newStage === 'done') {
                                // Task fully complete — remove from agent's queue
                                coreAgent.completeCurrentTask();
                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `✅ Task done: "${activeDbTask.title}" — ${summary}`
                                });
                            } else {
                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `📋 Stage advanced: "${activeDbTask.title}" → ${newStage?.toUpperCase()} — ${summary}`
                                });
                            }

                            // Update UI state
                            agentState.taskStage = newStage || '';
                            agentState.currentTask = coreAgent.currentTask || '';
                            agentState.action = coreAgent.currentTask ? 'work' : 'idle';

                            this.broadcast('task-update', {
                                agentId: id,
                                agentName: coreAgent.config.name,
                                task: activeDbTask.title,
                                status: newStage === 'done' ? 'completed' : 'in_progress',
                                stage: newStage || 'done'
                            });
                        }
                    }

                    // ─── HANDLE TALK ACTION ───
                    if (decision.action === 'talk' && decision.message) {
                        const targetName = decision.target || '';
                        let targetId = '';
                        this.coreAgents.forEach((a, aId) => {
                            if (a.config.name.toLowerCase() === targetName.toLowerCase()) targetId = aId;
                        });

                        const targetAgent = this.coreAgents.get(targetId);
                        if (targetAgent) {
                            // Agent-to-Agent message
                            const msg: ConversationMessage = {
                                from: coreAgent.config.name,
                                to: targetAgent.config.name,
                                content: decision.message,
                                timestamp: this.state.officeTime
                            };
                            targetAgent.receiveMessage(msg);
                            coreAgent.recordSentMessage(msg);

                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `💬 (to ${targetAgent.config.name}): ${decision.message}`
                            });
                            const a2aMsg = {
                                from: coreAgent.config.name,
                                fromId: id,
                                to: targetAgent.config.name,
                                toId: targetId,
                                content: decision.message,
                                timestamp: this.state.officeTime,
                                taskId: activeDbTask?.id || undefined,
                                taskTitle: activeDbTask?.title || undefined,
                            };
                            this.broadcast('agent-message', a2aMsg);
                            this.memoryStore.saveConversation(a2aMsg);

                            await this.memoryStore.saveMemory(id, {
                                content: `Said to ${targetAgent.config.name}: "${decision.message}"`,
                                type: 'conversation',
                                timestamp: this.state.officeTime,
                                importance: 0.7
                            }, this.sessionId);
                        } else {
                            // Agent replying to User (or unknown target) — send to dashboard
                            const replyTo = targetName || 'User';
                            const msg: ConversationMessage = {
                                from: coreAgent.config.name,
                                to: replyTo,
                                content: decision.message,
                                timestamp: this.state.officeTime
                            };
                            coreAgent.recordSentMessage(msg);

                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `💬 (to ${replyTo}): ${decision.message}`
                            });
                            const a2uMsg = {
                                from: coreAgent.config.name,
                                fromId: id,
                                to: replyTo,
                                toId: 'user',
                                content: decision.message,
                                timestamp: this.state.officeTime,
                                taskId: activeDbTask?.id || undefined,
                                taskTitle: activeDbTask?.title || undefined,
                            };
                            this.broadcast('agent-message', a2uMsg);
                            this.memoryStore.saveConversation(a2uMsg);
                        }
                    }

                    // Smart inbox clearing:
                    // - When user messages existed: only user messages were shown to LLM,
                    //   so clear user msgs (processed) and keep agent msgs (unseen)
                    // - When no user messages: all agent msgs were shown, clear everything
                    let respondedToUser = false;
                    if (decision.action === 'talk') {
                        const tgtName = (decision.target || '').toLowerCase();
                        let isAgentTarget = false;
                        this.coreAgents.forEach((a) => {
                            if (a.config.name.toLowerCase() === tgtName) isAgentTarget = true;
                        });
                        respondedToUser = !isAgentTarget;
                    }

                    if (hadUserMessages) {
                        if (respondedToUser) {
                            // User messages were processed — clear them, keep unseen agent msgs
                            const agentMsgs = coreAgent.inbox.filter(m => m.from !== 'User');
                            coreAgent.clearInbox();
                            for (const m of agentMsgs) coreAgent.inbox.push(m);
                            console.log(`[Think] ${coreAgent.config.name} responded to User ✓ (${agentMsgs.length} agent msgs queued for next cycle)`);
                        } else {
                            // LLM still didn't respond to user — preserve user msgs for retry
                            const userMsgs = coreAgent.inbox.filter(m => m.from === 'User');
                            coreAgent.clearInbox();
                            for (const m of userMsgs) coreAgent.inbox.push(m);
                            console.log(`[Think] ${coreAgent.config.name} FAILED to respond to User — ${userMsgs.length} msgs preserved for retry`);
                        }
                    } else {
                        coreAgent.clearInbox();
                    }

                    // ─── HANDLE TOOL EXECUTION ───
                    if (decision.action === 'use_tool' && decision.toolCall) {
                        // Special case: agent-created tasks
                        if (decision.toolCall.name === 'create_task') {
                            const { title, assignee } = decision.toolCall.params;
                            const targetId = assignee?.toLowerCase() || this.autoAssignAgent();
                            const targetAgent = this.coreAgents.get(targetId);
                            const targetState = this.state.agents.get(targetId);

                            if (targetAgent && targetState) {
                                targetAgent.enqueueTask(title, this.state.officeTime);
                                targetState.currentTask = targetAgent.currentTask;
                                await this.memoryStore.createTask(title, targetId);

                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `📋 Created task "${title}" for ${targetAgent.config.name}`
                                });
                                this.broadcast('task-update', {
                                    agentId: targetId,
                                    agentName: targetAgent.config.name,
                                    task: title,
                                    status: 'in_progress'
                                });
                            }
                        } else if (decision.toolCall.name === 'hire_agent') {
                            // ─── DYNAMIC AGENT HIRING ───
                            const hireParams = decision.toolCall.params;
                            const hireName = hireParams.name || ['Charlie', 'Diana', 'Eve', 'Frank', 'Grace'][this.hireCount % 5];
                            const hireRole = hireParams.role || 'Intern';
                            const hireId = `hire_${this.hireCount}`;

                            if (this.hireCount < 5 && !this.coreAgents.has(hireId)) {
                                // Spawn at office door (top-center), then walk to their desk
                                const spawnX = 20;
                                const spawnY = 2;

                                this.state.createAgent(hireId, hireName);
                                const hireState = this.state.agents.get(hireId);
                                if (hireState) { hireState.x = spawnX; hireState.y = spawnY; }

                                const hireAgent = new Agent({
                                    id: hireId, name: hireName, role: hireRole, avatar: 'sprite.png',
                                    inference: {
                                        provider: 'ollama',
                                        model: 'llama3.2:latest',
                                        systemPrompt: `You are ${hireName}, a ${hireRole} who just joined the team at a virtual office. You were hired by ${coreAgent.config.name}. Be enthusiastic, helpful, and eager to learn. Introduce yourself to your colleagues. Keep thoughts SHORT.`,
                                    },
                                    personality: {
                                        traits: { openness: 0.9, conscientiousness: 0.7, extraversion: 0.8, agreeableness: 0.9, neuroticism: 0.2 },
                                        communicationStyle: hireRole.includes('Design') ? 'creative' : 'casual',
                                        workHours: { start: '09:00', end: '17:00' },
                                        breakFrequency: 90
                                    },
                                    capabilities: [
                                        { name: 'code_execute', description: 'Execute JavaScript code' },
                                        { name: 'web_search', description: 'Search the web' },
                                        { name: 'write_note', description: 'Write a note' },
                                        { name: 'create_task', description: 'Create a task for the team' }
                                    ],
                                    memory: { shortTermLimit: 50 }
                                });

                                hireAgent.setInferenceAdapter(this.ollamaAdapter);
                                await hireAgent.initialize();
                                this.coreAgents.set(hireId, hireAgent);
                                this.thinkingLocks.set(hireId, false);

                                this.hireCount++;

                                this.broadcast('chat', {
                                    sender: '🏢 Office',
                                    text: `🎉 ${coreAgent.config.name} hired ${hireName} as ${hireRole}! Welcome to the team!`
                                });

                                // Give the hiring agent a memory of the hire
                                coreAgent.addMemory({
                                    content: `I hired ${hireName} as a ${hireRole}. They just joined the team.`,
                                    type: 'achievement',
                                    timestamp: this.state.officeTime,
                                    importance: 0.9
                                });
                            } else if (this.hireCount >= 5) {
                                this.broadcast('chat', {
                                    sender: '🏢 Office',
                                    text: `⚠️ ${coreAgent.config.name} tried to hire but the office is full! (Max 7 agents)`
                                });
                            }
                        } else {
                            const result = await this.toolExecutor.execute(
                                decision.toolCall.name,
                                decision.toolCall.params || {}
                            );

                            const output = result.output || '';
                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `🔧 Used tool [${decision.toolCall.name}]: ${result.success ? output.slice(0, 100) : (result.error || 'unknown error')}`
                            });

                            coreAgent.addMemory({
                                content: `Tool ${decision.toolCall.name} result: ${output.slice(0, 200)}`,
                                type: 'task_result',
                                timestamp: this.state.officeTime,
                                importance: 0.8
                            });
                        }
                    }

                    // ─── PERSIST MEMORIES PERIODICALLY ───
                    if (Math.random() < 0.3) {
                        const recentMemories = coreAgent.memories.slice(-3);
                        await this.memoryStore.saveMemories(id, recentMemories, this.sessionId);
                    }

                    // Reset error count on success
                    this.agentErrors.set(id, 0);

                    // Release sequential lock immediately so next agent can think
                    this.isProcessingThink = false;
                    // Cooldown per agent — fast-track if user messages still pending
                    const hasPendingUserMsg = coreAgent.inbox.some(m => m.from === 'User');
                    setTimeout(() => this.thinkingLocks.set(id, false), hasPendingUserMsg ? 3000 : 15000);

                }).catch(err => {
                    const errors = (this.agentErrors.get(id) || 0) + 1;
                    this.agentErrors.set(id, errors);
                    console.error(`[Health] Agent ${coreAgent.config.name} think error (${errors}/3):`, err.message || err);

                    if (errors >= 3) {
                        const team = this.agentTeam[id];
                        if (team && !this.pausedTeams.has(team)) {
                            this.pausedTeams.add(team);
                            console.error(`[Health] Agent ${coreAgent.config.name} failed 3x — pausing ${team} team`);
                            this.broadcast('teams-state', this.getTeamsState());
                            this.broadcast('chat', {
                                sender: 'System',
                                text: `⚠️ ${coreAgent.config.name} failed 3 times in a row. ${team} team paused.`
                            });
                        }
                    }

                    // On error: preserve user messages so they aren't lost
                    const userMsgs = coreAgent.inbox.filter(m => m.from === 'User');
                    coreAgent.clearInbox();
                    for (const m of userMsgs) coreAgent.inbox.push(m);

                    this.isProcessingThink = false;
                    // Faster retry if user messages pending, otherwise longer error cooldown
                    const pendingUser = coreAgent.inbox.some(m => m.from === 'User');
                    setTimeout(() => this.thinkingLocks.set(id, false), pendingUser ? 5000 : 30000);
                });
            }
        }

        // ─── FURNITURE INTERACTION PATHFINDING ───
        // Office grid boundaries (agents must stay inside)
        const BOUNDS = { minX: 2, maxX: 36, minY: 2, maxY: 36 };
        const clamp = (agent: any) => {
            agent.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, agent.x));
            agent.y = Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, agent.y));
        };

        this.demoTickCount++;
        if (this.demoTickCount >= 5) {
            this.demoTickCount = 0;
            this.state.agents.forEach((agent, key) => {
                const deskKey = `${key}-desk`;
                const desk = this.furnitureTargets[deskKey] || { x: 5, y: 18 };

                // ─── Determine final destination ───
                let finalTarget = { x: desk.x, y: desk.y };

                if (agent.action === 'talk') {
                    const coreAgent = this.coreAgents.get(key);
                    let found = false;
                    if (coreAgent) {
                        const lastSent = coreAgent.conversationHistory
                            .filter(m => m.from === coreAgent.config.name)
                            .slice(-1)[0];
                        if (lastSent) {
                            this.state.agents.forEach((other, otherKey) => {
                                if (otherKey === key) return;
                                const otherAgent = this.coreAgents.get(otherKey);
                                if (otherAgent && otherAgent.config.name === lastSent.to) {
                                    finalTarget = { x: other.x, y: other.y + 1 };
                                    found = true;
                                }
                            });
                        }
                    }
                    if (!found) {
                        // Fallback: closest agent
                        let minDist = Infinity;
                        this.state.agents.forEach((other, otherKey) => {
                            if (otherKey === key) return;
                            const dist = Math.abs(agent.x - other.x) + Math.abs(agent.y - other.y);
                            if (dist < minDist) { minDist = dist; finalTarget = { x: other.x, y: other.y + 1 }; }
                        });
                    }
                }

                // ─── Waypoint routing through doors ───
                const agentRoom = this.getRoomAt(agent.x, agent.y);
                const targetRoom = this.getRoomAt(finalTarget.x, finalTarget.y);
                let waypoints = this.agentWaypoints.get(key);

                // Generate waypoints if crossing rooms and we don't already have a path
                if (agentRoom && targetRoom && agentRoom !== targetRoom && (!waypoints || waypoints.length === 0)) {
                    const ownDoor = this.roomZones[agentRoom].door;
                    const destDoor = this.roomZones[targetRoom].door;
                    this.agentWaypoints.set(key, [ownDoor, destDoor, finalTarget]);
                    waypoints = this.agentWaypoints.get(key);
                }

                // Clear waypoints if already at destination or in same room
                if (agentRoom === targetRoom || (!agentRoom && !targetRoom)) {
                    this.agentWaypoints.set(key, []);
                    waypoints = undefined;
                }

                // Pick immediate move target
                let moveTarget = finalTarget;
                if (waypoints && waypoints.length > 0) {
                    moveTarget = waypoints[0];
                    const dist = Math.abs(agent.x - moveTarget.x) + Math.abs(agent.y - moveTarget.y);
                    if (dist <= 1) {
                        waypoints.shift();
                        if (waypoints.length > 0) {
                            moveTarget = waypoints[0];
                        } else {
                            moveTarget = finalTarget;
                        }
                    }
                }

                // Already close enough (for talk, stop within 2 tiles)
                const distToFinal = Math.abs(agent.x - finalTarget.x) + Math.abs(agent.y - finalTarget.y);
                if (agent.action === 'talk' && distToFinal <= 2 && (!waypoints || waypoints.length === 0)) {
                    return;
                }

                // Move 1 tile toward target
                if (agent.x < moveTarget.x) agent.x += 1;
                else if (agent.x > moveTarget.x) agent.x -= 1;
                else if (agent.y < moveTarget.y) agent.y += 1;
                else if (agent.y > moveTarget.y) agent.y -= 1;
                clamp(agent);
            });
        }
    }

    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined the office room!");

        // Sync per-team pause state
        client.send('teams-state', this.getTeamsState());

        // Send persisted history so UI is populated on connect
        this.memoryStore.getTasks().then(tasks => {
            client.send('tasks-sync', tasks);
        });
        this.memoryStore.getRecentConversations(200).then(msgs => {
            client.send('messages-sync', msgs);
        });
        this.memoryStore.getRecentActivityLogs(200).then(logs => {
            client.send('logs-sync', logs);
        });
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left the office room!");
    }

    async onDispose() {
        console.log("room", this.roomId, "disposing... saving memories");
        // Persist all agent memories on shutdown
        for (const [id, agent] of this.coreAgents) {
            await this.memoryStore.saveMemories(id, agent.memories, this.sessionId);
        }
        await this.memoryStore.close();
    }
}
