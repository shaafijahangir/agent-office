import React, { useState, useRef, useEffect } from 'react';
import type { AgentMessage } from '../App';

const agentColor: Record<string, string> = {
    manager: '#dfe6e9',
    cto: '#74b9ff',
    'vp-sales': '#00b894',
    cfo: '#fdcb6e',
    user: '#a29bfe',
};

const stageColor: Record<string, string> = {
    proposed: '#a29bfe',
    planned: '#74b9ff',
    implementing: '#fdcb6e',
    reviewing: '#fd79a8',
    done: '#00b894',
};

const stageIcon: Record<string, string> = {
    proposed: '💡',
    planned: '📐',
    implementing: '🔨',
    reviewing: '👀',
    done: '✅',
};

interface TaskThread {
    taskId: number;
    taskTitle: string;
    messages: AgentMessage[];
    participants: Set<string>;
    participantNames: Map<string, string>;
    lastActivity: string;
}

interface Props {
    messages: AgentMessage[];
}

export function DashboardThreads({ messages }: Props) {
    const [activeThread, setActiveThread] = useState<number | null>(null);
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, activeThread]);

    // Group messages by taskId — only show messages with task context
    const threadMap = new Map<number, TaskThread>();
    for (const msg of messages) {
        if (!msg.taskId) continue; // Skip messages without task context
        if (!threadMap.has(msg.taskId)) {
            threadMap.set(msg.taskId, {
                taskId: msg.taskId,
                taskTitle: msg.taskTitle || `Task #${msg.taskId}`,
                messages: [],
                participants: new Set(),
                participantNames: new Map(),
                lastActivity: msg.timestamp,
            });
        }
        const thread = threadMap.get(msg.taskId)!;
        thread.messages.push(msg);
        thread.participants.add(msg.fromId);
        thread.participantNames.set(msg.fromId, msg.from);
        if (msg.toId && msg.toId !== 'user') {
            thread.participants.add(msg.toId);
            thread.participantNames.set(msg.toId, msg.to);
        }
        thread.lastActivity = msg.timestamp;
    }

    const threads = [...threadMap.values()].sort(
        (a, b) => b.lastActivity.localeCompare(a.lastActivity)
    );

    const activeMessages = activeThread !== null
        ? threadMap.get(activeThread)?.messages || []
        : [];
    const activeInfo = activeThread !== null ? threadMap.get(activeThread) : null;

    const formatTime = (ts: string) => {
        try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
    };

    return (
        <div style={{ display: 'flex', height: '100%', background: '#0a0a1a' }}>
            {/* Thread list sidebar */}
            <div style={{
                width: 280, background: '#0d0d20', borderRight: '1px solid #1a1a3e',
                overflowY: 'auto', flexShrink: 0, padding: '8px 0',
            }}>
                <div style={{
                    padding: '8px 14px', fontSize: '10px', fontWeight: 700,
                    color: '#666', textTransform: 'uppercase', letterSpacing: 1,
                }}>Topics ({threads.length})</div>

                {threads.length === 0 && (
                    <div style={{
                        color: '#444', fontStyle: 'italic', fontSize: '12px',
                        padding: '40px 16px', textAlign: 'center',
                    }}>
                        No task discussions yet. Agents will create topics as they work.
                    </div>
                )}

                {threads.map(t => (
                    <button
                        key={t.taskId}
                        onClick={() => setActiveThread(t.taskId)}
                        style={{
                            display: 'flex', flexDirection: 'column', gap: 4,
                            width: '100%', padding: '10px 14px',
                            background: activeThread === t.taskId ? 'rgba(108,92,231,0.2)' : 'transparent',
                            border: 'none',
                            borderLeft: activeThread === t.taskId ? '3px solid #6c5ce7' : '3px solid transparent',
                            color: '#ddd', cursor: 'pointer', textAlign: 'left',
                        }}
                    >
                        {/* Task title */}
                        <div style={{
                            fontSize: '12px', fontWeight: 600, lineHeight: 1.3,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
                        }}>
                            {t.taskTitle}
                        </div>

                        {/* Participants + count */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {[...t.participantNames.entries()].map(([pid, pname]) => (
                                <span key={pid} style={{
                                    fontSize: '10px', fontWeight: 600,
                                    color: agentColor[pid] || '#888',
                                }}>{pname}</span>
                            ))}
                            <span style={{
                                marginLeft: 'auto', fontSize: '10px',
                                background: '#6c5ce7', color: '#fff',
                                borderRadius: 8, padding: '1px 6px', fontWeight: 700,
                            }}>{t.messages.length}</span>
                        </div>

                        {/* Last message preview */}
                        <div style={{
                            fontSize: '10px', color: '#555',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {t.messages[t.messages.length - 1]?.content.slice(0, 60)}
                        </div>
                    </button>
                ))}
            </div>

            {/* Thread detail */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {activeThread === null ? (
                    <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#444', fontStyle: 'italic', fontSize: '13px',
                    }}>
                        Select a topic to view the discussion
                    </div>
                ) : (
                    <>
                        {/* Header */}
                        <div style={{
                            padding: '12px 20px', borderBottom: '1px solid #1a1a3e',
                            flexShrink: 0,
                        }}>
                            <div style={{
                                fontWeight: 700, fontSize: '14px', color: '#ddd', marginBottom: 4,
                            }}>
                                {activeInfo?.taskTitle}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {activeInfo && [...activeInfo.participantNames.entries()].map(([pid, pname]) => (
                                    <span key={pid} style={{
                                        fontSize: '11px', fontWeight: 600,
                                        color: agentColor[pid] || '#888',
                                        background: `${agentColor[pid] || '#888'}20`,
                                        padding: '2px 8px', borderRadius: 4,
                                    }}>{pname}</span>
                                ))}
                                <span style={{ fontSize: '11px', color: '#555', marginLeft: 'auto' }}>
                                    {activeMessages.length} messages
                                </span>
                            </div>
                        </div>

                        {/* Messages */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
                            {activeMessages.map((m, i) => (
                                <div key={i} style={{ marginBottom: 10 }}>
                                    <div style={{
                                        fontSize: '10px', color: '#666', marginBottom: 2,
                                        display: 'flex', gap: 6, alignItems: 'center',
                                    }}>
                                        <span style={{
                                            fontWeight: 700,
                                            color: agentColor[m.fromId] || '#888',
                                        }}>{m.from}</span>
                                        <span style={{ color: '#444' }}>→ {m.to}</span>
                                        <span style={{ color: '#333', marginLeft: 'auto' }}>{formatTime(m.timestamp)}</span>
                                    </div>
                                    <div style={{
                                        background: 'rgba(255,255,255,0.04)',
                                        border: `1px solid ${agentColor[m.fromId] || '#333'}30`,
                                        borderLeft: `3px solid ${agentColor[m.fromId] || '#555'}`,
                                        padding: '8px 12px', borderRadius: '0 8px 8px 0',
                                        fontSize: '13px', lineHeight: 1.5, color: '#ddd',
                                    }}>
                                        {m.content}
                                    </div>
                                </div>
                            ))}
                            <div ref={endRef} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
