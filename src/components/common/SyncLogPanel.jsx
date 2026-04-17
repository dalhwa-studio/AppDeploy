import React, { useEffect, useRef, useState } from 'react';
import { io as socketIo } from 'socket.io-client';
import { Terminal, ChevronDown, ChevronUp, Trash2, Loader2 } from 'lucide-react';

const LEVEL_COLORS = {
  info: 'var(--text-secondary)',
  debug: 'var(--text-muted)',
  success: 'var(--color-success)',
  warn: 'var(--color-warning)',
  error: 'var(--color-error)',
};

const LEVEL_LABELS = {
  info: 'INFO',
  debug: 'DEBUG',
  success: 'OK',
  warn: 'WARN',
  error: 'ERR',
};

/**
 * Hook that opens a Socket.IO connection, exposes the socketId, and collects
 * `sync:*` events from the server into a local log buffer.
 *
 * Usage:
 *   const { socketId, logs, isActive, clear } = useSyncLog();
 *   // include `socketId` in the /api/sync/metadata/store body
 *   <SyncLogPanel logs={logs} isActive={isActive} onClear={clear} />
 */
export function useSyncLog() {
  const [socketId, setSocketId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const socket = socketIo('http://localhost:3721', { transports: ['websocket'] });
    socket.on('connect', () => setSocketId(socket.id));

    socket.on('sync:start', (data) => {
      setIsActive(true);
      setLogs(prev => [...prev, {
        level: 'info',
        message: `─── ${data.store === 'app_store' ? 'App Store' : 'Google Play'} 동기화 시작 ───`,
        timestamp: data.timestamp || new Date().toISOString(),
      }]);
    });

    socket.on('sync:log', (data) => {
      setLogs(prev => [...prev, {
        level: data.level || 'info',
        message: data.message,
        timestamp: data.timestamp || new Date().toISOString(),
      }]);
    });

    socket.on('sync:complete', (data) => {
      setIsActive(false);
      setLogs(prev => [...prev, {
        level: 'success',
        message: `완료: ${data.message || ''}`,
        timestamp: new Date().toISOString(),
      }]);
    });

    socket.on('sync:error', (data) => {
      setIsActive(false);
      setLogs(prev => [...prev, {
        level: 'error',
        message: `실패: ${data.error || ''}`,
        timestamp: new Date().toISOString(),
      }]);
    });

    return () => { socket.disconnect(); };
  }, []);

  return { socketId, logs, isActive, clear: () => setLogs([]) };
}

export default function SyncLogPanel({ logs = [], isActive = false, onClear }) {
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, expanded]);

  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  const count = logs.length;

  return (
    <div className="glass-card" style={{ marginTop: 'var(--space-md)', padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          background: 'var(--bg-elevated)',
          borderBottom: expanded ? '1px solid var(--border-subtle)' : 'none',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(e => !e)}
      >
        <Terminal size={14} />
        <strong style={{ fontSize: '0.8125rem' }}>동기화 로그</strong>
        {isActive && <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--color-primary)' }} />}
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {count === 0 ? '대기 중' : `${count}줄`}
        </span>
        <div style={{ flex: 1 }} />
        {count > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear?.(); }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex' }}
            title="로그 지우기"
          >
            <Trash2 size={14} />
          </button>
        )}
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </div>

      {expanded && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: 260,
            overflowY: 'auto',
            padding: '8px 12px',
            background: 'var(--bg-input)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            lineHeight: 1.6,
          }}
        >
          {count === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
              동기화를 실행하면 여기에 로그가 나타납니다.
            </div>
          ) : (
            logs.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                  {new Date(l.timestamp).toLocaleTimeString('ko-KR', { hour12: false })}
                </span>
                <span style={{ color: LEVEL_COLORS[l.level] || 'var(--text-secondary)', flexShrink: 0, fontWeight: 600, minWidth: 42 }}>
                  {LEVEL_LABELS[l.level] || l.level?.toUpperCase()}
                </span>
                <span style={{ color: 'var(--text-primary)' }}>{l.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
