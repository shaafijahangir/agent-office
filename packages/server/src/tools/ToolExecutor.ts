import { exec } from 'child_process';

export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
}

export class ToolExecutor {

    async execute(toolName: string, params: any): Promise<ToolResult> {
        switch (toolName) {
            case 'code_execute':
                return this.executeCode(params.code, params.language || 'javascript');
            case 'web_search':
                return this.webSearch(params.query);
            case 'write_note':
                return this.writeNote(params.content);
            case 'read_file':
                return this.readFile(params.path);
            // Tech Team tools
            case 'code_review':
                return this.codeReview(params.code);
            case 'architecture_plan':
                return this.architecturePlan(params.requirements);
            // Sales Team tools
            case 'market_research':
                return this.marketResearch(params.query);
            case 'draft_outreach':
                return this.draftOutreach(params.target, params.product);
            // Business Team tools
            case 'financial_model':
                return this.financialModel(params.revenue, params.costs, params.months);
            case 'write_report':
                return this.writeReport(params.topic, params.findings);
            case 'risk_analysis':
                return this.riskAnalysis(params.scenario);
            default:
                return { success: false, output: '', error: `Unknown tool: ${toolName}` };
        }
    }

    private executeCode(code: string, language: string): Promise<ToolResult> {
        return new Promise((resolve) => {
            // Sandbox: only allow JS/TS, with timeout
            if (language !== 'javascript' && language !== 'js') {
                resolve({ success: false, output: '', error: `Only JavaScript is supported for sandboxed execution.` });
                return;
            }

            // Wrap in a timeout to prevent infinite loops
            const wrappedCode = `
                const __timeout = setTimeout(() => { process.exit(1); }, 5000);
                try {
                    const result = (function() { ${code} })();
                    if (result !== undefined) console.log(JSON.stringify(result));
                    clearTimeout(__timeout);
                } catch(e) {
                    console.error(e.message);
                    clearTimeout(__timeout);
                    process.exit(1);
                }
            `;

            exec(`node -e "${wrappedCode.replace(/"/g, '\\"')}"`, { timeout: 6000 }, (error, stdout, stderr) => {
                if (error) {
                    resolve({ success: false, output: stderr || error.message, error: error.message });
                } else {
                    resolve({ success: true, output: stdout.trim() });
                }
            });
        });
    }

    private async webSearch(query: string): Promise<ToolResult> {
        try {
            // Use a simple fetch to DuckDuckGo Instant Answer API (no API key needed)
            const encoded = encodeURIComponent(query);
            const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`);
            const data = await res.json();

            const abstract = data.Abstract || data.AbstractText || '';
            const relatedTopics = (data.RelatedTopics || []).slice(0, 3).map((t: any) => t.Text || '').join('; ');

            const output = abstract
                ? `Result: ${abstract}`
                : relatedTopics
                    ? `Related: ${relatedTopics}`
                    : `No direct results for "${query}".`;

            return { success: true, output };
        } catch (e: any) {
            return { success: false, output: '', error: `Search failed: ${e.message}` };
        }
    }

    private async writeNote(content: string): Promise<ToolResult> {
        if (!content) return { success: false, output: '', error: 'No content provided for note.' };
        console.log(`[ToolExecutor] Note: ${content}`);
        return { success: true, output: `Note saved: "${content.slice(0, 50)}..."` };
    }

    private async readFile(path: string): Promise<ToolResult> {
        // Sandboxed: only allow reading from a safe directory
        const { readFile } = await import('fs/promises');
        try {
            if (path.includes('..') || path.startsWith('/')) {
                return { success: false, output: '', error: 'Path traversal not allowed.' };
            }
            const content = await readFile(path, 'utf-8');
            return { success: true, output: content.slice(0, 500) };
        } catch (e: any) {
            return { success: false, output: '', error: e.message };
        }
    }

    // ─── TECH TEAM TOOLS ───

    private async codeReview(code: string): Promise<ToolResult> {
        if (!code) return { success: false, output: '', error: 'No code provided for review.' };
        const review = [
            `CODE REVIEW`,
            `─────────────────────────`,
            `Lines: ~${code.split('\n').length}`,
            ``,
            `Snippet:`,
            code.slice(0, 300),
            ``,
            `Review Notes:`,
            `- Structure: Analyzed`,
            `- Complexity: Assessed`,
            `- Suggestions: Ready for discussion`,
            ``,
            `(Full analysis provided in agent's thought process)`
        ].join('\n');
        return { success: true, output: review };
    }

    private async architecturePlan(requirements: string): Promise<ToolResult> {
        if (!requirements) return { success: false, output: '', error: 'No requirements provided.' };
        const plan = [
            `ARCHITECTURE PLAN`,
            `─────────────────────────`,
            `Requirements: ${requirements.slice(0, 200)}`,
            ``,
            `Components to define:`,
            `- Frontend layer`,
            `- API / Backend services`,
            `- Database / Storage`,
            `- Infrastructure / Hosting`,
            `- Third-party integrations`,
            ``,
            `(Detailed architecture in agent's analysis)`
        ].join('\n');
        return { success: true, output: plan };
    }

    // ─── SALES TEAM TOOLS ───

    private async marketResearch(query: string): Promise<ToolResult> {
        // Enhanced web search formatted as market intel
        const searchResult = await this.webSearch(query);
        if (!searchResult.success) return searchResult;

        const report = [
            `MARKET RESEARCH REPORT`,
            `─────────────────────────`,
            `Query: ${query}`,
            ``,
            `Findings:`,
            searchResult.output,
            ``,
            `Analysis Areas:`,
            `- Market size & growth`,
            `- Key players & competitors`,
            `- Trends & opportunities`,
            `- Customer segments`,
            ``,
            `(Strategic insights in agent's analysis)`
        ].join('\n');
        return { success: true, output: report };
    }

    private async draftOutreach(target: string, product: string): Promise<ToolResult> {
        if (!target || !product) return { success: false, output: '', error: 'Need target and product params.' };
        const draft = [
            `OUTREACH DRAFT`,
            `─────────────────────────`,
            `Target: ${target}`,
            `Product: ${product}`,
            ``,
            `Template:`,
            `Subject: How ${product} can help ${target}`,
            ``,
            `Hi [Name],`,
            ``,
            `I noticed [specific observation about ${target}].`,
            `We built ${product} to solve exactly this — [value prop].`,
            ``,
            `Would you be open to a 15-min call this week?`,
            ``,
            `(Agent will customize based on context)`
        ].join('\n');
        return { success: true, output: draft };
    }

    // ─── BUSINESS TEAM TOOLS ───

    private async financialModel(revenue: number, costs: number, months: number): Promise<ToolResult> {
        const r = revenue || 0;
        const c = costs || 0;
        const m = months || 12;
        const rows: string[] = [
            `FINANCIAL PROJECTION`,
            `─────────────────────────`,
            `Month | Revenue | Costs | Net | Cumulative`,
        ];
        let cumulative = 0;
        for (let i = 1; i <= Math.min(m, 12); i++) {
            const monthRevenue = Math.round(r * (1 + (i - 1) * 0.15)); // 15% MoM growth
            const monthCosts = Math.round(c * (1 + (i - 1) * 0.05)); // 5% MoM cost increase
            const net = monthRevenue - monthCosts;
            cumulative += net;
            rows.push(`  ${String(i).padStart(2)}   | $${String(monthRevenue).padStart(7)} | $${String(monthCosts).padStart(7)} | $${String(net).padStart(7)} | $${String(cumulative).padStart(8)}`);
        }
        rows.push(``, `Assumptions: 15% MoM revenue growth, 5% MoM cost growth`);
        return { success: true, output: rows.join('\n') };
    }

    private async writeReport(topic: string, findings: string): Promise<ToolResult> {
        if (!topic) return { success: false, output: '', error: 'No topic provided.' };
        const report = [
            `BUSINESS REPORT`,
            `═════════════════════════`,
            `Topic: ${topic}`,
            `Date: ${new Date().toLocaleDateString()}`,
            ``,
            `Executive Summary:`,
            `(To be completed by agent)`,
            ``,
            `Key Findings:`,
            findings ? findings.slice(0, 500) : '(Pending analysis)',
            ``,
            `Recommendations:`,
            `(To be completed by agent)`,
            ``,
            `Next Steps:`,
            `(To be completed by agent)`
        ].join('\n');
        return { success: true, output: report };
    }

    private async riskAnalysis(scenario: string): Promise<ToolResult> {
        if (!scenario) return { success: false, output: '', error: 'No scenario provided.' };
        const analysis = [
            `RISK ANALYSIS`,
            `─────────────────────────`,
            `Scenario: ${scenario.slice(0, 200)}`,
            ``,
            `Risk Matrix:`,
            `  Impact →    Low    Medium    High`,
            `  Likely   |   ⬜   |   🟡   |   🔴   |`,
            `  Possible |   ⬜   |   🟡   |   🟡   |`,
            `  Unlikely |   ⬜   |   ⬜   |   🟡   |`,
            ``,
            `Categories to assess:`,
            `- Market risk`,
            `- Technical risk`,
            `- Financial risk`,
            `- Operational risk`,
            `- Competitive risk`,
            ``,
            `(Detailed risk scoring in agent's analysis)`
        ].join('\n');
        return { success: true, output: analysis };
    }
}
