import React, { useState, useEffect, useRef, useCallback } from 'react';
import { setupPhaser, getColyseusRoom, ensureColyseusConnection } from './game/Game';
import { DashboardChat } from './components/DashboardChat';
import { DashboardTasks } from './components/DashboardTasks';
import { DashboardLogs } from './components/DashboardLogs';
import { DashboardThreads } from './components/DashboardThreads';
import { AgentStatusBar } from './components/AgentStatusBar';

type Tab = 'office' | 'chat' | 'threads' | 'logs' | 'tasks';

const MAX_EVENTS = 500;

const AGENT_ROLES: Record<string, string> = {
    manager: 'CEO / Manager',
    cto: 'CTO',
    'vp-sales': 'VP Sales',
    cfo: 'CFO',
};

export interface AgentInfo {
    id: string;
    name: string;
    role: string;
    action: string;
    thought: string;
    currentTask: string;
    taskStage: string;
}

export interface AgentMessage {
    from: string;
    fromId: string;
    to: string;
    toId: string;
    content: string;
    timestamp: string;
    taskId?: number;
    taskTitle?: string;
}

export interface LogEntry {
    agentId: string;
    agentName: string;
    action: string;
    thought: string;
    target: string;
    message: string;
    tool: string;
    task: string;
    timestamp: string;
}

export interface TeamsState {
    executive: boolean;
    tech: boolean;
    sales: boolean;
    business: boolean;
}

export function App() {
    const [activeTab, setActiveTab] = useState<Tab>('office');
    const [agents, setAgents] = useState<AgentInfo[]>([]);
    const [chatTarget, setChatTarget] = useState<string>('manager');
    const phaserRef = useRef<HTMLDivElement>(null);
    const phaserInitRef = useRef(false);

    // ─── Centralized event stores (persist across tab switches) ───
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [teamsState, setTeamsState] = useState<TeamsState>({
        executive: false, tech: false, sales: false, business: false,
    });
    const listenersRef = useRef(false);

    // Connect to Colyseus immediately on mount (before Phaser loads)
    useEffect(() => {
        ensureColyseusConnection().catch(err =>
            console.error('[App] Colyseus connection failed:', err)
        );
    }, []);

    // Initialize Phaser once
    useEffect(() => {
        if (phaserRef.current && !phaserInitRef.current) {
            phaserInitRef.current = true;
            setupPhaser('phaser-game');
        }
    }, []);

    // ─── Single listener registration for all Colyseus events ───
    useEffect(() => {
        const checkRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (room && !listenersRef.current) {
                listenersRef.current = true;

                // Live events
                room.onMessage('agent-message', (data: AgentMessage) => {
                    setMessages(prev => [...prev.slice(-(MAX_EVENTS - 1)), data]);
                });

                room.onMessage('agent-log', (data: LogEntry) => {
                    setLogs(prev => [...prev.slice(-(MAX_EVENTS - 1)), data]);
                });

                room.onMessage('teams-state', (data: TeamsState) => {
                    setTeamsState(data);
                });

                // History sync on connect — populates UI with persisted data
                room.onMessage('messages-sync', (data: AgentMessage[]) => {
                    setMessages(prev => [...data, ...prev].slice(-MAX_EVENTS));
                });

                room.onMessage('logs-sync', (data: LogEntry[]) => {
                    setLogs(prev => [...data, ...prev].slice(-MAX_EVENTS));
                });

                clearInterval(checkRoom);
            }
        }, 500);
        return () => clearInterval(checkRoom);
    }, []);

    // Poll Colyseus state for agent info
    useEffect(() => {
        const poll = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                const state = room.state as any;
                if (state?.agents) {
                    const list: AgentInfo[] = [];
                    state.agents.forEach((a: any, id: string) => {
                        list.push({
                            id,
                            name: a.name,
                            role: AGENT_ROLES[id] || '',
                            action: a.action || 'idle',
                            thought: a.thought || '',
                            currentTask: a.currentTask || '',
                            taskStage: a.taskStage || ''
                        });
                    });
                    setAgents(list);
                }
            }
        }, 2000);
        return () => clearInterval(poll);
    }, []);

    const handleAgentClick = useCallback((agentId: string) => {
        setChatTarget(agentId);
        setActiveTab('chat');
    }, []);

    const toggleTeam = useCallback((team: string) => {
        const room = getColyseusRoom();
        if (room) room.send('toggle-team', { team });
    }, []);

    const toggleAll = useCallback(() => {
        const room = getColyseusRoom();
        if (room) room.send('toggle-all');
    }, []);

    const clearLogs = useCallback(() => setLogs([]), []);

    const allRunning = teamsState.executive && teamsState.tech && teamsState.sales && teamsState.business;
    const allPaused = !teamsState.executive && !teamsState.tech && !teamsState.sales && !teamsState.business;
    const runningCount = [teamsState.executive, teamsState.tech, teamsState.sales, teamsState.business].filter(Boolean).length;

    const tabStyle = (tab: Tab) => ({
        padding: '8px 20px',
        fontSize: '13px',
        fontWeight: activeTab === tab ? 700 : 400,
        color: activeTab === tab ? '#fff' : '#888',
        background: activeTab === tab ? 'rgba(108,92,231,0.3)' : 'transparent',
        border: 'none',
        borderBottom: activeTab === tab ? '2px solid #6c5ce7' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.15s',
    } as React.CSSProperties);

    const teamBtnStyle = (running: boolean) => ({
        padding: '3px 10px', borderRadius: 4, fontSize: '10px', fontWeight: 600,
        border: running ? '1px solid #00b894' : '1px solid #444',
        background: running ? 'rgba(0,184,148,0.15)' : 'rgba(255,255,255,0.03)',
        color: running ? '#00b894' : '#666',
        cursor: 'pointer', transition: 'all 0.15s',
    } as React.CSSProperties);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a1a' }}>
            {/* ─── TOP BAR ─── */}
            <div style={{
                display: 'flex', alignItems: 'center', padding: '0 16px',
                height: 44, background: '#0d0d20', borderBottom: '1px solid #1a1a3e',
                flexShrink: 0
            }}>
                <span style={{ fontSize: '15px', fontWeight: 700, marginRight: 24 }}>
                    🏢 AgentOffice
                </span>
                <button style={tabStyle('office')} onClick={() => setActiveTab('office')}>Office</button>
                <button style={tabStyle('chat')} onClick={() => setActiveTab('chat')}>Chat</button>
                <button style={tabStyle('threads')} onClick={() => setActiveTab('threads')}>Threads</button>
                <button style={tabStyle('logs')} onClick={() => setActiveTab('logs')}>Logs</button>
                <button style={tabStyle('tasks')} onClick={() => setActiveTab('tasks')}>Tasks</button>
                <div style={{ flex: 1 }} />

                {/* ─── Per-team controls ─── */}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginRight: 8 }}>
                    <button style={teamBtnStyle(teamsState.executive)} onClick={() => toggleTeam('executive')}>
                        {teamsState.executive ? '▶' : '⏸'} Exec
                    </button>
                    <button style={teamBtnStyle(teamsState.tech)} onClick={() => toggleTeam('tech')}>
                        {teamsState.tech ? '▶' : '⏸'} Tech
                    </button>
                    <button style={teamBtnStyle(teamsState.sales)} onClick={() => toggleTeam('sales')}>
                        {teamsState.sales ? '▶' : '⏸'} Sales
                    </button>
                    <button style={teamBtnStyle(teamsState.business)} onClick={() => toggleTeam('business')}>
                        {teamsState.business ? '▶' : '⏸'} Biz
                    </button>
                    <button
                        onClick={toggleAll}
                        style={{
                            padding: '3px 10px', borderRadius: 4, fontSize: '10px', fontWeight: 700,
                            border: allRunning ? '1px solid #e17055' : '1px solid #00b894',
                            background: allRunning ? 'rgba(225,112,85,0.15)' : 'rgba(0,184,148,0.15)',
                            color: allRunning ? '#e17055' : '#00b894',
                            cursor: 'pointer', marginLeft: 4,
                        }}
                    >
                        {allPaused ? '▶ All' : allRunning ? '⏸ All' : `${runningCount}/4`}
                    </button>
                </div>

                <span style={{ fontSize: '10px', color: '#555' }}>
                    🤖 Ollama &middot; {agents.length} agents
                </span>
            </div>

            {/* ─── AGENT STATUS BAR ─── */}
            <AgentStatusBar agents={agents} activeChat={chatTarget} onAgentClick={handleAgentClick} />

            {/* ─── MAIN CONTENT ─── */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <div
                    ref={phaserRef}
                    id="phaser-game"
                    style={{
                        position: 'absolute', inset: 0,
                        visibility: activeTab === 'office' ? 'visible' : 'hidden',
                        pointerEvents: activeTab === 'office' ? 'auto' : 'none',
                    }}
                />

                {activeTab === 'chat' && (
                    <DashboardChat
                        agents={agents}
                        activeAgent={chatTarget}
                        onSelectAgent={setChatTarget}
                        messages={messages}
                    />
                )}

                {activeTab === 'threads' && (
                    <DashboardThreads messages={messages} />
                )}

                {activeTab === 'logs' && (
                    <DashboardLogs logs={logs} messages={messages} onClear={clearLogs} />
                )}

                {activeTab === 'tasks' && (
                    <DashboardTasks agents={agents} />
                )}
            </div>
        </div>
    );
}
