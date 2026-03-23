import React, { useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';

interface AgentInfo {
    id: string;
    name: string;
    role: string;
    action: string;
    thought: string;
    currentTask: string;
    taskStage?: string;
}

interface TaskItem {
    id: number;
    title: string;
    assigned_to: string;
    status: string;
    stage?: string;
}

const teamColor: Record<string, string> = {
    manager: '#dfe6e9',
    cto: '#74b9ff',
    'vp-sales': '#00b894',
    cfo: '#fdcb6e',
};

const stageIcon: Record<string, string> = {
    proposed: '💡',
    planned: '📐',
    implementing: '🔨',
    reviewing: '👀',
    done: '✅',
    pending: '⏳',
};

const stageColor: Record<string, string> = {
    proposed: '#a29bfe',
    planned: '#74b9ff',
    implementing: '#fdcb6e',
    reviewing: '#fd79a8',
    done: '#00b894',
    pending: '#636e72',
};

const statusIcon: Record<string, string> = {
    completed: '✅',
    in_progress: '🔄',
    pending: '⏳',
};

const statusColor: Record<string, string> = {
    completed: '#00b894',
    in_progress: '#fdcb6e',
    pending: '#636e72',
};

export function DashboardTasks({ agents }: { agents: AgentInfo[] }) {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('manager');

    useEffect(() => {
        const checkRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                room.onMessage('task-update', (data: any) => {
                    setTasks(prev => {
                        const existing = prev.find(t => t.title === data.task);
                        if (existing) {
                            return prev.map(t => t.title === data.task ? { ...t, status: data.status, assigned_to: data.agentId, stage: data.stage || t.stage } : t);
                        }
                        return [...prev, { id: Date.now(), title: data.task, assigned_to: data.agentId, status: data.status, stage: data.stage || 'proposed' }];
                    });
                });
                room.onMessage('tasks-sync', (serverTasks: any[]) => {
                    setTasks(serverTasks.map(t => ({
                        id: t.id,
                        title: t.title,
                        assigned_to: t.assigned_to || '',
                        status: t.status,
                        stage: t.stage || 'pending'
                    })));
                });
                clearInterval(checkRoom);
            }
        }, 500);
        return () => clearInterval(checkRoom);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('assign-task', { title: newTask, agentId: targetAgent });
            setNewTask('');
        }
    };

    // Group tasks by agent
    const tasksByAgent: Record<string, TaskItem[]> = {};
    for (const t of tasks) {
        const key = t.assigned_to || 'unassigned';
        if (!tasksByAgent[key]) tasksByAgent[key] = [];
        tasksByAgent[key].push(t);
    }

    // Stats
    const total = tasks.length;
    const proposed = tasks.filter(t => t.stage === 'proposed').length;
    const implementing = tasks.filter(t => t.stage === 'implementing' || t.stage === 'planned').length;
    const reviewing = tasks.filter(t => t.stage === 'reviewing').length;
    const completed = tasks.filter(t => t.stage === 'done' || t.status === 'completed').length;

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a1a' }}>
            {/* Header with stats */}
            <div style={{
                padding: '14px 24px', borderBottom: '1px solid #1a1a3e',
                display: 'flex', alignItems: 'center', gap: 24, flexShrink: 0
            }}>
                <span style={{ fontSize: '15px', fontWeight: 700 }}>📋 Task Board</span>
                <div style={{ display: 'flex', gap: 12, fontSize: '12px' }}>
                    <span style={{ color: '#636e72' }}>Total: {total}</span>
                    <span style={{ color: '#a29bfe' }}>💡 {proposed}</span>
                    <span style={{ color: '#fdcb6e' }}>🔨 {implementing}</span>
                    <span style={{ color: '#fd79a8' }}>👀 {reviewing}</span>
                    <span style={{ color: '#00b894' }}>✅ {completed}</span>
                </div>
            </div>

            {/* Task assignment form */}
            <form onSubmit={handleSubmit} style={{
                padding: '12px 24px', borderBottom: '1px solid #1a1a3e',
                display: 'flex', gap: 8, flexShrink: 0
            }}>
                <input
                    type="text"
                    value={newTask}
                    onChange={e => setNewTask(e.target.value)}
                    placeholder="Describe a task..."
                    style={{
                        flex: 1, padding: '10px 14px', borderRadius: 8,
                        border: '1px solid #2a2a4e', background: '#12122a',
                        color: '#fff', fontSize: '13px', outline: 'none'
                    }}
                />
                <select
                    value={targetAgent}
                    onChange={e => setTargetAgent(e.target.value)}
                    style={{
                        padding: '8px 12px', borderRadius: 8,
                        border: '1px solid #2a2a4e', background: '#12122a',
                        color: '#aaa', fontSize: '12px'
                    }}
                >
                    {agents.map(a => (
                        <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                    ))}
                </select>
                <button type="submit" style={{
                    padding: '10px 20px', borderRadius: 8, border: 'none',
                    background: '#6c5ce7', color: '#fff', fontSize: '13px',
                    fontWeight: 600, cursor: 'pointer'
                }}>Assign</button>
            </form>

            {/* Task grid by agent */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                {/* Active agent tasks */}
                {agents.map(a => {
                    const agentTasks = tasksByAgent[a.id] || [];
                    const queuedCount = agentTasks.filter(t => t.status !== 'completed').length;
                    return (
                        <div key={a.id} style={{ marginBottom: 16 }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                marginBottom: 6, fontSize: '12px'
                            }}>
                                <span style={{
                                    fontWeight: 700,
                                    color: teamColor[a.id] || '#ddd'
                                }}>{a.name}</span>
                                <span style={{ color: '#555' }}>{a.role}</span>
                                {a.currentTask && (
                                    <span style={{
                                        fontSize: '10px', color: stageColor[a.taskStage || 'implementing'] || '#fdcb6e',
                                        background: `${stageColor[a.taskStage || 'implementing'] || '#fdcb6e'}15`,
                                        padding: '1px 6px', borderRadius: 4
                                    }}>{stageIcon[a.taskStage || 'implementing'] || '🔨'} {a.taskStage?.toUpperCase() || 'WORKING'}: {a.currentTask}</span>
                                )}
                                {queuedCount > 1 && (
                                    <span style={{
                                        fontSize: '10px', color: '#888',
                                        background: 'rgba(255,255,255,0.05)',
                                        padding: '1px 6px', borderRadius: 4
                                    }}>+{queuedCount - 1} queued</span>
                                )}
                            </div>
                            {agentTasks.length === 0 ? (
                                <div style={{
                                    fontSize: '11px', color: '#333', fontStyle: 'italic',
                                    padding: '4px 0'
                                }}>No tasks</div>
                            ) : (
                                agentTasks.map(t => {
                                    const stage = t.stage || 'pending';
                                    return (
                                        <div key={t.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '6px 10px', marginBottom: 3, borderRadius: 6,
                                            background: 'rgba(255,255,255,0.03)',
                                            borderLeft: `3px solid ${stageColor[stage] || '#636e72'}`
                                        }}>
                                            <span>{stageIcon[stage] || '⏳'}</span>
                                            <span style={{ flex: 1, fontSize: '12px' }}>{t.title}</span>
                                            <span style={{
                                                fontSize: '10px', color: stageColor[stage] || '#636e72',
                                                background: `${stageColor[stage] || '#636e72'}20`,
                                                padding: '1px 6px', borderRadius: 4,
                                                textTransform: 'uppercase', fontWeight: 600
                                            }}>{stage}</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
