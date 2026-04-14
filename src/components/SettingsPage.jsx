import React, { useState, useEffect, useRef } from 'react';
import {
  Settings, Server, Shield, Database, Download, Upload,
  Trash2, CheckCircle2, AlertCircle, RefreshCw, Info, Key, Terminal
} from 'lucide-react';
import { useApp } from '../hooks/useAppContext';
import { API_BASE } from '../utils/constants';

export default function SettingsPage() {
  const { apps, storeAccounts, dispatch, addToast } = useApp();
  const [serverHealth, setServerHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef(null);

  // Check server health
  useEffect(() => {
    checkServerHealth();
  }, []);

  const checkServerHealth = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      setServerHealth(data);
    } catch {
      setServerHealth(null);
    }
    setLoading(false);
  };

  // Export data
  const handleExport = () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      apps,
      storeAccounts: {
        googlePlay: storeAccounts.googlePlay ? { ...storeAccounts.googlePlay, credentialId: undefined } : null,
        appStore: storeAccounts.appStore ? { ...storeAccounts.appStore, credentialId: undefined } : null,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appdeploy-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('데이터가 내보내기되었습니다.', 'success');
  };

  // Import data
  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.version || !Array.isArray(data.apps)) {
          addToast('유효하지 않은 백업 파일입니다.', 'error');
          return;
        }
        data.apps.forEach(app => {
          dispatch({ type: 'ADD_APP', payload: app });
        });
        addToast(`${data.apps.length}개 앱이 가져오기되었습니다.`, 'success');
      } catch {
        addToast('파일 파싱 실패. JSON 형식을 확인해 주세요.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Clear all data
  const handleClearData = () => {
    if (!window.confirm('모든 앱 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    apps.forEach(app => {
      dispatch({ type: 'DELETE_APP', payload: app.id });
    });
    dispatch({ type: 'UPDATE_STORE_ACCOUNTS', payload: { googlePlay: null, appStore: null } });
    addToast('모든 데이터가 삭제되었습니다.', 'info');
  };

  // Disconnect store account
  const handleDisconnectStore = (store) => {
    const label = store === 'googlePlay' ? 'Google Play' : 'App Store';
    if (!window.confirm(`${label} 연결을 해제하시겠습니까?`)) return;
    dispatch({ type: 'UPDATE_STORE_ACCOUNTS', payload: { [store]: null } });
    addToast(`${label} 연결이 해제되었습니다.`, 'info');
  };

  return (
    <div className="fade-in" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <h2>설정</h2>
      </div>
      <div className="page-content">
        {/* Server Status */}
        <div className="section">
          <div className="section-header">
            <Server size={18} className="icon" />
            <h3>서버 상태</h3>
          </div>
          <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
            {loading ? (
              <div className="flex items-center gap-sm">
                <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '0.875rem' }}>서버 상태 확인 중...</span>
              </div>
            ) : serverHealth ? (
              <div className="flex flex-col gap-md">
                <div className="flex items-center gap-sm">
                  <CheckCircle2 size={18} style={{ color: 'var(--color-success)' }} />
                  <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>서버 연결됨</span>
                  <button className="btn btn-ghost btn-sm" onClick={checkServerHealth} style={{ marginLeft: 'auto' }}>
                    <RefreshCw size={14} /> 새로고침
                  </button>
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-sm)', fontSize: '0.8125rem',
                }}>
                  <div style={{ padding: 'var(--space-sm)', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>암호화</span>
                    <div style={{ fontWeight: 600 }}>
                      {serverHealth.encryption === 'active' ? 'AES-256-GCM 활성' : '비활성'}
                    </div>
                  </div>
                  <div style={{ padding: 'var(--space-sm)', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Fastlane</span>
                    <div style={{ fontWeight: 600 }}>{serverHealth.fastlane}</div>
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  서버 URL: <span style={{ fontFamily: 'var(--font-mono)' }}>{API_BASE.replace('/api', '')}</span>
                  {' '}· 마지막 확인: {new Date(serverHealth.timestamp).toLocaleString('ko-KR')}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-sm">
                <AlertCircle size={18} style={{ color: 'var(--color-error)' }} />
                <span style={{ color: 'var(--color-error)', fontWeight: 600 }}>서버 연결 실패</span>
                <button className="btn btn-ghost btn-sm" onClick={checkServerHealth} style={{ marginLeft: 'auto' }}>
                  <RefreshCw size={14} /> 재시도
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Fastlane */}
        <div className="section">
          <div className="section-header">
            <Terminal size={18} className="icon" />
            <h3>Fastlane</h3>
          </div>
          <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
            {serverHealth ? (
              <div className="flex flex-col gap-sm">
                <div className="flex items-center gap-sm">
                  {serverHealth.fastlane !== 'not installed' ? (
                    <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
                  ) : (
                    <AlertCircle size={16} style={{ color: 'var(--text-muted)' }} />
                  )}
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                    {serverHealth.fastlane !== 'not installed' ? serverHealth.fastlane : '설치되지 않음'}
                  </span>
                </div>
                {serverHealth.fastlane === 'not installed' && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Fastlane을 설치하면 메타데이터 동기화, 스크린샷 업로드 등을 자동화할 수 있습니다.
                    <br />
                    설치: <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4 }}>brew install fastlane</code> 또는{' '}
                    <code style={{ background: 'var(--bg-input)', padding: '2px 6px', borderRadius: 4 }}>gem install fastlane</code>
                  </div>
                )}
                {serverHealth.fastlane !== 'not installed' && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    메타데이터 동기화 시 Fastlane deliver(iOS)/supply(Android)를 사용할 수 있습니다.
                  </div>
                )}
              </div>
            ) : (
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>서버 연결 후 확인 가능</span>
            )}
          </div>
        </div>

        {/* Store Accounts */}
        <div className="section">
          <div className="section-header">
            <Key size={18} className="icon" />
            <h3>스토어 계정</h3>
          </div>
          <div className="flex flex-col gap-md">
            {/* Google Play */}
            <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
              <div className="flex items-center gap-sm">
                <div style={{
                  width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                  background: 'var(--google-play-bg)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', color: 'var(--google-play)',
                }}>G</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Google Play</div>
                  {storeAccounts.googlePlay ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>
                      연결됨 · {storeAccounts.googlePlay.fileName}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>미연결</div>
                  )}
                </div>
                {storeAccounts.googlePlay && (
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDisconnectStore('googlePlay')}>
                    연결 해제
                  </button>
                )}
              </div>
            </div>

            {/* App Store */}
            <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
              <div className="flex items-center gap-sm">
                <div style={{
                  width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                  background: 'var(--apple-store-bg)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', color: 'var(--apple-store)',
                }}>A</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>App Store</div>
                  {storeAccounts.appStore ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>
                      연결됨 · Key: {storeAccounts.appStore.keyId} · {storeAccounts.appStore.fileName}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>미연결</div>
                  )}
                </div>
                {storeAccounts.appStore && (
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDisconnectStore('appStore')}>
                    연결 해제
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Data Management */}
        <div className="section">
          <div className="section-header">
            <Database size={18} className="icon" />
            <h3>데이터 관리</h3>
          </div>
          <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
            <div className="flex flex-col gap-md">
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                현재 {apps.length}개 앱이 로컬 스토리지에 저장되어 있습니다.
              </div>
              <div className="flex items-center gap-md" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={handleExport}>
                  <Download size={14} /> 데이터 내보내기
                </button>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  <Upload size={14} /> 데이터 가져오기
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImport}
                    style={{ display: 'none' }}
                  />
                </label>
                <button
                  className="btn btn-sm"
                  style={{
                    background: 'var(--color-error)',
                    color: '#fff',
                    border: 'none',
                    marginLeft: 'auto',
                  }}
                  onClick={handleClearData}
                  disabled={apps.length === 0}
                >
                  <Trash2 size={14} /> 전체 삭제
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* About */}
        <div className="section">
          <div className="section-header">
            <Info size={18} className="icon" />
            <h3>정보</h3>
          </div>
          <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <div><strong>AppDeploy</strong> v0.1.0</div>
              <div>Google Play & App Store 통합 배포 관리 도구</div>
              <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                React 19 + Express 5 + Socket.IO + Google APIs + App Store Connect API
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
