import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Smartphone, Search, LayoutGrid, MoreVertical,
  Copy, Trash2, PlayCircle, Apple
} from 'lucide-react';
import { useApp } from '../../hooks/useAppContext';
import StatusBadge from '../common/StatusBadge';
import Modal from '../common/Modal';
import { CATEGORIES, DEFAULT_APP, APP_STATUSES } from '../../utils/constants';

export default function AppList() {
  const { apps, dispatch, addToast } = useApp();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [newApp, setNewApp] = useState({ name: '', iosBundleId: '', androidPackageName: '', category: '' });
  const [contextMenu, setContextMenu] = useState(null);

  /* ─── Filter logic ─── */
  const filteredApps = apps.filter(app => {
    const matchSearch = !searchQuery ||
      (app.shared?.appName || app.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (app.iosBundleId || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (app.androidPackageName || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = statusFilter === 'all' || app.status === statusFilter;
    return matchSearch && matchStatus;
  });

  /* ─── Create app ─── */
  const handleCreate = () => {
    if (!newApp.name.trim()) {
      addToast('앱 이름을 입력해 주세요.', 'warning');
      return;
    }
    dispatch({
      type: 'ADD_APP',
      payload: {
        name: newApp.name,
        iosBundleId: newApp.iosBundleId,
        androidPackageName: newApp.androidPackageName,
        category: newApp.category,
        shared: { ...DEFAULT_APP.shared, appName: newApp.name },
      },
    });
    addToast(`"${newApp.name}" 앱이 생성되었습니다.`, 'success');
    setNewApp({ name: '', iosBundleId: '', androidPackageName: '', category: '' });
    setShowCreateModal(false);
  };

  /* ─── Context menu actions ─── */
  const handleDuplicate = (appId) => {
    dispatch({ type: 'DUPLICATE_APP', payload: appId });
    addToast('앱이 복사되었습니다.', 'success');
    setContextMenu(null);
  };

  const handleDelete = (appId) => {
    const app = apps.find(a => a.id === appId);
    if (window.confirm(`"${app?.shared?.appName || app?.name}" 앱을 삭제하시겠습니까?`)) {
      dispatch({ type: 'DELETE_APP', payload: appId });
      addToast('앱이 삭제되었습니다.', 'info');
    }
    setContextMenu(null);
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.06 }
    }
  };

  const item = {
    hidden: { y: 20, opacity: 0 },
    show: { y: 0, opacity: 1 }
  };

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div className="detail-header">
          <LayoutGrid size={22} style={{ color: 'var(--accent-primary)' }} />
          <h2>앱 목록</h2>
          <span className="badge badge-draft" style={{ marginLeft: 8 }}>
            {apps.length}개
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={18} />
          새 앱 추가
        </button>
      </div>

      {/* Content */}
      <div className="page-content">
        {/* Search & Filter */}
        <div className="flex items-center gap-md mb-lg">
          <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
            <Search size={16} style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--text-muted)'
            }} />
            <input
              type="text"
              placeholder="앱 이름, Bundle ID로 검색..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 38 }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ width: 'auto', minWidth: 140 }}
          >
            <option value="all">모든 상태</option>
            <option value="draft">초안</option>
            <option value="ready">준비 완료</option>
            <option value="published">게시됨</option>
            <option value="in_review">심사 중</option>
          </select>
        </div>

        {/* App Grid */}
        {filteredApps.length > 0 ? (
          <motion.div
            className="app-grid"
            variants={container}
            initial="hidden"
            animate="show"
          >
            {filteredApps.map(app => (
              <motion.div
                key={app.id}
                variants={item}
                className="glass-card interactive app-card"
                onClick={() => dispatch({ type: 'SET_CURRENT_APP', payload: app.id })}
              >
                {/* Context menu */}
                <div style={{ position: 'absolute', top: 12, right: 12 }}>
                  <button
                    className="btn-ghost btn-icon"
                    onClick={e => {
                      e.stopPropagation();
                      setContextMenu(contextMenu === app.id ? null : app.id);
                    }}
                    style={{ padding: 4 }}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {contextMenu === app.id && (
                    <div style={{
                      position: 'absolute',
                      right: 0,
                      top: '100%',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-primary)',
                      borderRadius: 'var(--radius-md)',
                      padding: 4,
                      minWidth: 140,
                      zIndex: 20,
                      boxShadow: 'var(--shadow-lg)',
                    }}>
                      <button
                        className="nav-item"
                        style={{ fontSize: '0.8125rem', padding: '8px 12px' }}
                        onClick={e => { e.stopPropagation(); handleDuplicate(app.id); }}
                      >
                        <Copy size={14} /> 복사
                      </button>
                      <button
                        className="nav-item"
                        style={{ fontSize: '0.8125rem', padding: '8px 12px', color: 'var(--color-error)' }}
                        onClick={e => { e.stopPropagation(); handleDelete(app.id); }}
                      >
                        <Trash2 size={14} /> 삭제
                      </button>
                    </div>
                  )}
                </div>

                {/* Card content */}
                <div className="app-card-header">
                  <div className="app-icon">
                    {app.icon ? (
                      <img src={app.icon} alt="" />
                    ) : (
                      <Smartphone size={22} />
                    )}
                  </div>
                  <div className="app-card-info">
                    <h3>{app.shared?.appName || app.name || '이름 없음'}</h3>
                    <div className="bundle-id">
                      {app.iosBundleId || app.androidPackageName || 'Bundle ID 미설정'}
                    </div>
                  </div>
                </div>

                <div className="app-card-stores">
                  {app.androidPackageName && <span className="badge badge-google"><PlayCircle size={12} /> Google</span>}
                  {app.iosBundleId && <span className="badge badge-apple"><Apple size={12} /> Apple</span>}
                  {!app.androidPackageName && !app.iosBundleId && (
                    <span className="badge badge-draft">스토어 미설정</span>
                  )}
                </div>

                <div className="app-card-meta">
                  <StatusBadge status={app.status} />
                  <span className="last-deploy">
                    {app.updatedAt
                      ? new Date(app.updatedAt).toLocaleDateString('ko-KR')
                      : '—'}
                  </span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="empty-state">
            <Smartphone size={64} className="icon" />
            <h3>{searchQuery ? '검색 결과가 없습니다' : '등록된 앱이 없습니다'}</h3>
            <p className="text-secondary">
              {searchQuery
                ? '다른 검색어를 시도해 보세요.'
                : '새 앱을 추가하여 스토어 배포를 시작하세요.'}
            </p>
            {!searchQuery && (
              <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                <Plus size={18} /> 첫 번째 앱 추가
              </button>
            )}
          </div>
        )}
      </div>

      {/* Click-away handler for context menu */}
      {contextMenu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 15 }}
          onClick={() => setContextMenu(null)} />
      )}

      {/* Create App Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="새 앱 추가"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
              취소
            </button>
            <button className="btn btn-primary" onClick={handleCreate}>
              <Plus size={16} /> 앱 생성
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-md">
          <div className="input-group">
            <label>앱 이름 <span className="required">*</span></label>
            <input
              type="text"
              placeholder="예: My Awesome App"
              value={newApp.name}
              onChange={e => setNewApp({ ...newApp, name: e.target.value })}
              autoFocus
            />
          </div>
          <div className="field-grid">
            <div className="input-group">
              <label>iOS Bundle ID</label>
              <input
                type="text"
                placeholder="com.example.app"
                value={newApp.iosBundleId}
                onChange={e => setNewApp({ ...newApp, iosBundleId: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label>Android Package Name</label>
              <input
                type="text"
                placeholder="com.example.app"
                value={newApp.androidPackageName}
                onChange={e => setNewApp({ ...newApp, androidPackageName: e.target.value })}
              />
            </div>
          </div>
          <div className="input-group">
            <label>카테고리</label>
            <select
              value={newApp.category}
              onChange={e => setNewApp({ ...newApp, category: e.target.value })}
            >
              <option value="">선택...</option>
              {CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </>
  );
}
