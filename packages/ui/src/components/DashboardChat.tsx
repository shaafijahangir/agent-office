import React, { useState, useEffect, useRef } from 'react';
import { getColyseusRoom } from '../game/Game';
import type { AgentInfo, AgentMessage } from '../App';

const AGENT_ORDER = ['manager', 'cto', 'vp-sales', 'cfo'];

const teamLabel: Record<string, string> = {
    manager: '👔 Executive',
    cto: '💻 Tech',
    'vp-sales': '📈 Sales',
    cfo: '📊 Business',
};

const teamColor: Record<string, string> = {
    manager: '#dfe6e9',
    cto: '#74b9ff',
    'vp-sales': '#00b894',
    cfo: '#fdcb6e',
};

interface Props {
    agents: AgentInfo[];
    activeAgent: string;
    onSelectAgent: (id: string) => void;
    messages: AgentMessage[];
}

export function DashboardChat({ agents, activeAgent, onSelectAgent, messages }: Props) {
    const [input, setInput] = useState('');
    const endRef = useRef<HTMLDivElement>(null);

    // Auto-scroll
    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, activeAgent]);

    const send = () => {
        if (!input.trim()) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('dm-agent', { agentId: activeAgent, text: input });
            setInput('');
        }
    };

    // Filter messages for the active agent
    const activeAgentInfo = agents.find(a => a.id === activeAgent);
    const agentName = activeAgentInfo?.name || activeAgent;

    // Show only messages where the User is one side and the active agent is the other
    const filtered = messages.filter(m => {
        const isAgentSide = m.fromId === activeAgent || m.toId === activeAgent ||
            m.from === agentName || m.to === agentName;
        const isUserSide = m.from === 'User' || m.fromId === 'user' ||
            m.to === 'User' || m.toId === 'user';
        return isAgentSide && isUserSide;
    });

    // Group sidebar by team
    const teams: Record<string, AgentInfo[]> = {};
    for (const a of agents) {
        const team = teamLabel[a.id] || 'Other';
        if (!teams[team]) teams[team] = [];
        teams[team].push(a);
    }

    // Count recent DM messages (User ↔ Agent only) for badge
    const msgCountFor = (id: string) => {
        const name = agents.find(a => a.id === id)?.name || id;
        return messages.filter(m => {
            const isAgent = m.fromId === id || m.toId === id || m.from === name || m.to === name;
            const isUser = m.from === 'User' || m.fromId === 'user' || m.to === 'User' || m.toId === 'user';
            return isAgent && isUser && m.timestamp > (Date.now() - 60000).toString();
        }).length;
    };

    return (
        <div style={{ display: 'flex', height: '100%', background: '#0a0a1a' }}>
            {/* ─── SIDEBAR: Agent list ─── */}
            <div style={{
                width: 220, background: '#0d0d20', borderRight: '1px solid #1a1a3e',
                overflowY: 'auto', flexShrink: 0, padding: '8px 0'
            }}>
                {Object.entries(teams).map(([team, teamAgents]) => (
                    <div key={team}>
                        <div style={{
                            padding: '6px 14px', fontSize: '10px', fontWeight: 700,
                            color: '#666', textTransform: 'uppercase', letterSpacing: 1
                        }}>{team}</div>
                        {teamAgents.sort((a, b) => AGENT_ORDER.indexOf(a.id) - AGENT_ORDER.indexOf(b.id)).map(a => {
                            const count = msgCountFor(a.id);
                            return (
                                <button
                                    key={a.id}
                                    onClick={() => onSelectAgent(a.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        width: '100%', padding: '8px 14px',
                                        background: activeAgent === a.id ? 'rgba(108,92,231,0.2)' : 'transparent',
                                        border: 'none', borderLeft: activeAgent === a.id ? '3px solid #6c5ce7' : '3px solid transparent',
                                        color: '#ddd', cursor: 'pointer', textAlign: 'left',
                                        fontSize: '12px',
                                    }}
                                >
                                    <span style={{ fontWeight: 600, color: teamColor[a.id] || '#ddd' }}>{a.name}</span>
                                    <span style={{ fontSize: '10px', color: '#666', flex: 1 }}>{a.role}</span>
                                    {count > 0 && (
                                        <span style={{
                                            background: '#6c5ce7', color: '#fff', borderRadius: 8,
                                            padding: '1px 6px', fontSize: '9px', fontWeight: 700
                                        }}>{count}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>

            {/* ─── MAIN CHAT AREA ─── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div style={{
                    padding: '10px 20px', borderBottom: '1px solid #1a1a3e',
                    display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0
                }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: teamColor[activeAgent] || '#ddd' }}>
                        {agentName}
                    </span>
                    <span style={{ fontSize: '12px', color: '#666' }}>
                        {activeAgentInfo?.role}
                    </span>
                    {activeAgentInfo?.currentTask && (
                        <span style={{
                            fontSize: '10px', color: '#fdcb6e', background: 'rgba(253,203,110,0.1)',
                            padding: '2px 8px', borderRadius: 4
                        }}>
                            Working: {activeAgentInfo.currentTask}
                        </span>
                    )}
                    {activeAgentInfo?.thought && (
                        <span style={{
                            fontSize: '10px', color: '#888', fontStyle: 'italic', marginLeft: 'auto'
                        }}>
                            💭 {activeAgentInfo.thought.slice(0, 60)}
                        </span>
                    )}
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
                    {filtered.length === 0 && (
                        <div style={{ color: '#444', fontStyle: 'italic', fontSize: '13px', padding: '40px 0', textAlign: 'center' }}>
                            No DMs with {agentName} yet. Type below to start a conversation.
                        </div>
                    )}
                    {filtered.map((m, i) => {
                        const isUser = m.from === 'User' || m.fromId === 'user';
                        return (
                            <div key={i} style={{
                                display: 'flex', flexDirection: 'column',
                                alignItems: isUser ? 'flex-end' : 'flex-start',
                                marginBottom: 8
                            }}>
                                <div style={{
                                    fontSize: '10px', color: '#666', marginBottom: 2,
                                    display: 'flex', gap: 6
                                }}>
                                    <span style={{ fontWeight: 600, color: isUser ? '#a29bfe' : teamColor[m.fromId] || '#888' }}>
                                        {m.from}
                                    </span>
                                    <span>→ {m.to}</span>
                                </div>
                                <div style={{
                                    background: isUser ? 'rgba(108,92,231,0.2)' : 'rgba(255,255,255,0.06)',
                                    border: isUser ? '1px solid rgba(108,92,231,0.3)' : '1px solid rgba(255,255,255,0.06)',
                                    padding: '8px 12px', borderRadius: 8,
                                    maxWidth: '70%', fontSize: '13px', lineHeight: 1.5,
                                    color: '#ddd'
                                }}>
                                    {m.content}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={endRef} />
                </div>

                {/* Input */}
                <div style={{
                    padding: '12px 20px', borderTop: '1px solid #1a1a3e',
                    display: 'flex', gap: 8, flexShrink: 0
                }}>
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && send()}
                        placeholder={`Message ${agentName}...`}
                        style={{
                            flex: 1, padding: '10px 14px', borderRadius: 8,
                            border: '1px solid #2a2a4e', background: '#12122a',
                            color: '#fff', fontSize: '13px', outline: 'none',
                        }}
                    />
                    <button
                        onClick={send}
                        style={{
                            padding: '10px 20px', borderRadius: 8, border: 'none',
                            background: '#6c5ce7', color: '#fff', fontSize: '13px',
                            fontWeight: 600, cursor: 'pointer'
                        }}
                    >Send</button>
                </div>
            </div>
        </div>
    );
}
