import React, { useState, useEffect, useRef } from 'react';
import type { LogEntry, AgentMessage } from '../App';

const agentColor: Record<string, string> = {
    manager: '#dfe6e9',
    cto: '#74b9ff',
    'vp-sales': '#00b894',
    cfo: '#fdcb6e',
    user: '#a29bfe',
};

interface Props {
    logs: LogEntry[];
    messages: AgentMessage[];
    onClear: () => void;
}

interface FeedItem {
    timestamp: string;
    line: React.ReactNode;
    agentId: string;
    type: 'decision' | 'message';
}

function ts(iso: string): string {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return ''; }
}

function Name({ id, name }: { id: string; name: string }) {
    return <span style={{ color: agentColor[id] || '#ddd', fontWeight: 700 }}>{name}</span>;
}

function buildFeed(logs: LogEntry[], messages: AgentMessage[]): FeedItem[] {
    const items: FeedItem[] = [];

    for (const l of logs) {
        // Skip if thought is empty/generic
        const thought = l.thought && l.thought !== 'Thinking...' && l.thought !== 'Systems recovering...'
            ? l.thought : '';

        let line: React.ReactNode;

        if (l.action === 'talk') {
            // Talk decisions are shown via messages feed — skip all talk entries from logs
            continue;
        } else if (l.action === 'propose_task') {
            line = (
                <span>
                    <Name id={l.agentId} name={l.agentName} />
                    <span style={{ color: '#a29bfe' }}> proposed task</span>
                    {l.message && <span style={{ color: '#ddd' }}>: {l.message.length > 80 ? l.message.slice(0, 80) + '...' : l.message}</span>}
                </span>
            );
        } else if (l.action === 'complete_task') {
            line = (
                <span>
                    <Name id={l.agentId} name={l.agentName} />
                    <span style={{ color: '#00b894' }}> completed stage</span>
                    {l.task && <span style={{ color: '#74b9ff' }}> on {l.task.length > 50 ? l.task.slice(0, 50) + '...' : l.task}</span>}
                    {l.message && <span style={{ color: '#555', fontStyle: 'italic' }}> — "{l.message.slice(0, 60)}"</span>}
                </span>
            );
        } else if (l.action === 'work') {
            line = (
                <span>
                    <Name id={l.agentId} name={l.agentName} />
                    <span style={{ color: '#636e72' }}> is working</span>
                    {l.task && <span style={{ color: '#74b9ff' }}> on {l.task.length > 60 ? l.task.slice(0, 60) + '...' : l.task}</span>}
                    {thought && <span style={{ color: '#555', fontStyle: 'italic' }}> — "{thought}"</span>}
                </span>
            );
        } else if (l.action === 'use_tool') {
            line = (
                <span>
                    <Name id={l.agentId} name={l.agentName} />
                    <span style={{ color: '#a29bfe' }}> used </span>
                    <span style={{ color: '#e17055', fontWeight: 600 }}>{l.tool}</span>
                    {l.message && <span style={{ color: '#888' }}> — {l.message.slice(0, 80)}</span>}
                </span>
            );
        } else if (l.action === 'idle') {
            line = (
                <span>
                    <Name id={l.agentId} name={l.agentName} />
                    <span style={{ color: '#636e72' }}> idle</span>
                    {thought && <span style={{ color: '#555', fontStyle: 'italic' }}> — "{thought}"</span>}
                </span>
            );
        } else {
            // Fallback for unknown actions
            line = (
                <span>
                    <Name id={l.agentId} name={l.agentName} />
                    <span style={{ color: '#636e72' }}> {l.action}</span>
                    {thought && <span style={{ color: '#555', fontStyle: 'italic' }}> — "{thought}"</span>}
                </span>
            );
        }

        items.push({ timestamp: l.timestamp, line, agentId: l.agentId, type: 'decision' });
    }

    for (const m of messages) {
        const line = (
            <span>
                <Name id={m.fromId} name={m.from} />
                <span style={{ color: '#636e72' }}> → </span>
                <Name id={m.toId} name={m.to} />
                <span style={{ color: '#ddd' }}>: {m.content}</span>
            </span>
        );
        items.push({ timestamp: m.timestamp, line, agentId: m.fromId, type: 'message' });
    }

    items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return items;
}

export function DashboardLogs({ logs, messages, onClear }: Props) {
    const [filter, setFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const endRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const autoScrollRef = useRef(true);

    // Only auto-scroll if user is near bottom
    useEffect(() => {
        if (autoScrollRef.current) {
            endRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, messages]);

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        autoScrollRef.current = nearBottom;
    };

    const feed = buildFeed(logs, messages);

    const filtered = feed.filter(item => {
        if (filter !== 'all' && item.agentId !== filter) return false;
        if (typeFilter === 'messages' && item.type !== 'message') return false;
        if (typeFilter === 'decisions' && item.type !== 'decision') return false;
        return true;
    });

    const agentIds = [...new Set(feed.map(f => f.agentId))];

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a1a' }}>
            {/* Toolbar */}
            <div style={{
                padding: '8px 16px', borderBottom: '1px solid #1a1a3e',
                display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}>
                <span style={{ fontSize: '13px', fontWeight: 700, marginRight: 8 }}>Activity</span>
                <span style={{ fontSize: '11px', color: '#555' }}>{filtered.length}</span>

                <div style={{ flex: 1 }} />

                {/* Type filter pills */}
                {['all', 'messages', 'decisions'].map(t => (
                    <button
                        key={t}
                        onClick={() => setTypeFilter(t)}
                        style={{
                            padding: '3px 10px', borderRadius: 4, fontSize: '10px',
                            border: typeFilter === t ? '1px solid #6c5ce7' : '1px solid #2a2a4e',
                            background: typeFilter === t ? 'rgba(108,92,231,0.2)' : '#12122a',
                            color: typeFilter === t ? '#a29bfe' : '#666',
                            cursor: 'pointer', textTransform: 'capitalize',
                        }}
                    >{t}</button>
                ))}

                <select
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    style={{
                        padding: '3px 8px', borderRadius: 4,
                        border: '1px solid #2a2a4e', background: '#12122a',
                        color: '#aaa', fontSize: '10px',
                    }}
                >
                    <option value="all">All</option>
                    {agentIds.map(id => (
                        <option key={id} value={id}>
                            {feed.find(f => f.agentId === id)?.line ? id : id}
                        </option>
                    ))}
                </select>

                <button
                    onClick={onClear}
                    style={{
                        padding: '3px 8px', borderRadius: 4, border: '1px solid #2a2a4e',
                        background: '#12122a', color: '#666', fontSize: '10px', cursor: 'pointer',
                    }}
                >Clear</button>
            </div>

            {/* Feed */}
            <div
                ref={containerRef}
                onScroll={handleScroll}
                style={{
                    flex: 1, overflowY: 'auto', padding: '4px 16px',
                    fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
                    fontSize: '12px', lineHeight: 1.8,
                }}
            >
                {filtered.length === 0 && (
                    <div style={{ color: '#444', fontStyle: 'italic', fontSize: '12px', padding: '40px 0', textAlign: 'center' }}>
                        No activity yet. Hit "Run" to start the simulation.
                    </div>
                )}
                {filtered.map((item, i) => (
                    <div key={i} style={{
                        display: 'flex', gap: 10,
                        opacity: item.type === 'decision' ? 0.7 : 1,
                    }}>
                        <span style={{ color: '#444', flexShrink: 0, width: 65 }}>
                            {ts(item.timestamp)}
                        </span>
                        <span style={{ flexShrink: 0, width: 14, textAlign: 'center' }}>
                            {item.type === 'message' ? '›' : '·'}
                        </span>
                        <span style={{ flex: 1, wordBreak: 'break-word' }}>
                            {item.line}
                        </span>
                    </div>
                ))}
                <div ref={endRef} />
            </div>
        </div>
    );
}
