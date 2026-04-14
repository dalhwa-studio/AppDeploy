import React from 'react';
import {
  Rocket, LayoutGrid, Settings, ArrowLeft,
  Smartphone, FileText, Image as ImageIcon,
  ShoppingBag, Upload, Apple, PlayCircle, Globe
} from 'lucide-react';
import { useApp } from '../../hooks/useAppContext';

const DETAIL_TABS = [
  { id: 'shared', label: '공통 정보', icon: FileText },
  { id: 'google', label: 'Google Play', icon: PlayCircle },
  { id: 'apple', label: 'App Store', icon: Apple },
  { id: 'build', label: 'Build & Release', icon: Upload },
];

export default function Sidebar({ activeTab, onTabChange }) {
  const { currentApp, currentAppId, storeAccounts, dispatch } = useApp();

  const handleBack = () => {
    dispatch({ type: 'SET_CURRENT_APP', payload: null });
  };

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="logo-icon">
            <Rocket size={20} />
          </div>
          <h1>AppDeploy</h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {currentAppId && currentApp ? (
          <>
            {/* Back to list */}
            <button className="nav-item" onClick={handleBack} style={{ marginBottom: 8 }}>
              <ArrowLeft size={18} />
              <span>앱 목록</span>
            </button>

            {/* Current app info */}
            <div style={{
              padding: '12px 14px',
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 16,
            }}>
              <div className="flex items-center gap-sm">
                <div className="app-icon" style={{ width: 36, height: 36 }}>
                  {currentApp.icon ? (
                    <img src={currentApp.icon} alt="" />
                  ) : (
                    <Smartphone size={16} />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentApp.shared?.appName || currentApp.name || '이름 없음'}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {currentApp.iosBundleId || currentApp.androidPackageName || 'Bundle ID 미설정'}
                  </div>
                </div>
              </div>
            </div>

            {/* Detail tabs */}
            {DETAIL_TABS.map(tab => (
              <button
                key={tab.id}
                className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => onTabChange(tab.id)}
              >
                <tab.icon size={18} />
                <span>{tab.label}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            <button className="nav-item active">
              <LayoutGrid size={18} />
              <span>앱 목록</span>
            </button>
            <button className="nav-item" onClick={() => dispatch({ type: 'ADD_TOAST', payload: { message: '설정 기능은 준비 중입니다.', type: 'info' } })}>
              <Settings size={18} />
              <span>설정</span>
            </button>
          </>
        )}
      </nav>

      {/* Store connection status */}
      <div className="sidebar-footer">
        <div className="store-status">
          <span className={`dot ${storeAccounts.googlePlay ? 'connected' : 'disconnected'}`} />
          <span>Google Play: {storeAccounts.googlePlay ? '연결됨' : '미연결'}</span>
        </div>
        <div className="store-status">
          <span className={`dot ${storeAccounts.appStore ? 'connected' : 'disconnected'}`} />
          <span>App Store: {storeAccounts.appStore ? '연결됨' : '미연결'}</span>
        </div>
      </div>
    </aside>
  );
}
