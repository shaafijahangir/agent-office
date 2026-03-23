import React, { useState } from 'react';

interface AgentInfo {
    id: string;
    name: string;
    role: string;
    action: string;
    thought: string;
    currentTask: string;
}

const actionIcon: Record<string, string> = {
    work: '💻',
    talk: '💬',
    idle: '😴',
    use_tool: '🔧',
    move: '🚶',
};

const actionColor: Record<string, string> = {
    work: '#fdcb6e',
    talk: '#74b9ff',
    idle: '#636e72',
    use_tool: '#a29bfe',
};

const teamColor: Record<string, string> = {
    manager: '#dfe6e9',
    cto: '#74b9ff',
    'vp-sales': '#00b894',
    cfo: '#fdcb6e',
};

export function AgentStatusBar({ agents, activeChat, onAgentClick }: {
    agents: AgentInfo[];
    activeChat: string;
    onAgentClick: (id: string) => void;
}) {
    const [showThoughts, setShowThoughts] = useState(false);

    return (
        <div style={{ flexShrink: 0 }}>
            <div style={{
                display: 'flex', gap: 4, padding: '6px 16px',
                background: '#0d0d20', borderBottom: '1px solid #1a1a3e',
                overflowX: 'auto',
            }}>
                {agents.map(a => (
                    <button
                        key={a.id}
                        onClick={() => onAgentClick(a.id)}
                        title={`${a.name} (${a.role}) — ${a.action}${a.currentTask ? `: ${a.currentTask}` : ''}`}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '4px 10px', borderRadius: 6,
                            background: activeChat === a.id ? 'rgba(108,92,231,0.25)' : 'rgba(255,255,255,0.04)',
                            border: activeChat === a.id ? '1px solid rgba(108,92,231,0.5)' : '1px solid transparent',
                            color: '#ddd', cursor: 'pointer',
                            fontSize: '11px', whiteSpace: 'nowrap',
                            transition: 'all 0.15s',
                        }}
                    >
                        <span style={{ fontSize: '13px' }}>{actionIcon[a.action] || '😴'}</span>
                        <span style={{
                            fontWeight: 600,
                            color: teamColor[a.id] || '#ddd'
                        }}>{a.name}</span>
                        <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: actionColor[a.action] || '#636e72',
                            flexShrink: 0
                        }} />
                    </button>
                ))}

                {/* Thoughts toggle */}
                <button
                    onClick={() => setShowThoughts(s => !s)}
                    style={{
                        marginLeft: 'auto', padding: '4px 10px', borderRadius: 6,
                        background: showThoughts ? 'rgba(162,155,254,0.2)' : 'rgba(255,255,255,0.04)',
                        border: showThoughts ? '1px solid rgba(162,155,254,0.4)' : '1px solid transparent',
                        color: showThoughts ? '#a29bfe' : '#666',
                        cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                    }}
                >
                    {showThoughts ? '🧠 Hide Thoughts' : '🧠 Thoughts'}
                </button>
            </div>

            {/* Thoughts panel */}
            {showThoughts && (
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 6, padding: '8px 16px',
                    background: '#0a0a18', borderBottom: '1px solid #1a1a3e',
                }}>
                    {agents.map(a => (
                        <div key={a.id} style={{
                            padding: '6px 10px', borderRadius: 6,
                            background: 'rgba(255,255,255,0.03)',
                            borderLeft: `3px solid ${teamColor[a.id] || '#555'}`,
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3,
                            }}>
                                <span style={{ fontSize: '12px' }}>{actionIcon[a.action] || '😴'}</span>
                                <span style={{
                                    fontWeight: 700, fontSize: '11px',
                                    color: teamColor[a.id] || '#ddd',
                                }}>{a.name}</span>
                                <span style={{ fontSize: '9px', color: '#555' }}>{a.role}</span>
                            </div>
                            <div style={{
                                fontSize: '11px', color: '#999', fontStyle: 'italic',
                                lineHeight: 1.4,
                            }}>
                                {a.thought || 'No thoughts yet...'}
                            </div>
                            {a.currentTask && (
                                <div style={{
                                    fontSize: '9px', color: '#fdcb6e', marginTop: 3,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    Task: {a.currentTask}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
