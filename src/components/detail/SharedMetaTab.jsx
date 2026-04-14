import React, { useCallback, useState } from 'react';
import {
  FileText, Link2, Hash, Image as ImageIcon,
  Upload, X, GripVertical
} from 'lucide-react';
import { useApp } from '../../hooks/useAppContext';
import CharCounter from '../common/CharCounter';
import { FIELD_LIMITS, CATEGORIES } from '../../utils/constants';

export default function SharedMetaTab() {
  const { currentApp, dispatch, addToast } = useApp();
  const shared = currentApp?.shared || {};

  const updateField = useCallback((path, value) => {
    dispatch({
      type: 'UPDATE_APP_FIELD',
      payload: { id: currentApp.id, path: `shared.${path}`, value },
    });
  }, [currentApp?.id, dispatch]);

  const updateAppRoot = useCallback((path, value) => {
    dispatch({
      type: 'UPDATE_APP_FIELD',
      payload: { id: currentApp.id, path, value },
    });
  }, [currentApp?.id, dispatch]);

  /* ─── Icon upload ─── */
  const handleIconUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('이미지 파일만 업로드 가능합니다.', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      updateAppRoot('icon', ev.target.result);
      addToast('아이콘이 설정되었습니다.', 'success');
    };
    reader.readAsDataURL(file);
  };

  /* ─── Screenshot upload ─── */
  const handleScreenshotUpload = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const screenshots = [...(shared.screenshots || [])];
    let loaded = 0;

    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        screenshots.push({
          id: crypto.randomUUID(),
          dataUrl: ev.target.result,
          fileName: file.name,
        });
        loaded++;
        if (loaded === files.length) {
          updateField('screenshots', screenshots);
          addToast(`${loaded}개 스크린샷이 추가되었습니다.`, 'success');
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeScreenshot = (id) => {
    updateField(
      'screenshots',
      (shared.screenshots || []).filter(s => s.id !== id)
    );
  };

  if (!currentApp) return null;

  return (
    <div className="fade-in">
      {/* Basic Info */}
      <div className="section">
        <div className="section-header">
          <FileText size={18} className="icon" />
          <h3>앱 기본 정보</h3>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-lg)' }}>
          {/* Icon */}
          <div style={{ flexShrink: 0 }}>
            <label htmlFor="icon-upload" style={{ cursor: 'pointer' }}>
              <div className="app-icon" style={{
                width: 100, height: 100,
                borderRadius: 'var(--radius-lg)',
                fontSize: '0.6875rem',
                flexDirection: 'column',
                gap: 4,
              }}>
                {currentApp.icon ? (
                  <img src={currentApp.icon} alt="App Icon" style={{ borderRadius: 'var(--radius-lg)' }} />
                ) : (
                  <>
                    <Upload size={20} />
                    <span>아이콘</span>
                  </>
                )}
              </div>
            </label>
            <input
              id="icon-upload"
              type="file"
              accept="image/*"
              onChange={handleIconUpload}
              style={{ display: 'none' }}
            />
            <div style={{ textAlign: 'center', fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 4 }}>
              1024 × 1024
            </div>
          </div>

          {/* Fields */}
          <div style={{ flex: 1 }}>
            <div className="field-grid">
              <div className="input-group">
                <label>앱 이름 <span className="required">*</span></label>
                <input
                  type="text"
                  placeholder="My App"
                  value={shared.appName || ''}
                  onChange={e => updateField('appName', e.target.value.slice(0, FIELD_LIMITS.appName))}
                  maxLength={FIELD_LIMITS.appName}
                />
                <CharCounter current={(shared.appName || '').length} max={FIELD_LIMITS.appName} />
              </div>
              <div className="input-group">
                <label>카테고리</label>
                <select
                  value={currentApp.category || ''}
                  onChange={e => updateAppRoot('category', e.target.value)}
                >
                  <option value="">선택...</option>
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>iOS Bundle ID</label>
                <input
                  type="text"
                  placeholder="com.company.app"
                  value={currentApp.iosBundleId || ''}
                  onChange={e => updateAppRoot('iosBundleId', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
                />
              </div>
              <div className="input-group">
                <label>Android Package Name</label>
                <input
                  type="text"
                  placeholder="com.company.app"
                  value={currentApp.androidPackageName || ''}
                  onChange={e => updateAppRoot('androidPackageName', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="section">
        <div className="section-header">
          <FileText size={18} className="icon" />
          <h3>앱 설명</h3>
        </div>
        <div className="input-group">
          <textarea
            placeholder="앱의 기능과 특징을 상세히 설명해 주세요. 이 내용은 Google Play '전체 설명'과 App Store '설명'에 공통으로 사용됩니다."
            value={shared.description || ''}
            onChange={e => updateField('description', e.target.value.slice(0, FIELD_LIMITS.description))}
            rows={8}
            style={{ minHeight: 180 }}
          />
          <CharCounter current={(shared.description || '').length} max={FIELD_LIMITS.description} />
        </div>
      </div>

      {/* URLs */}
      <div className="section">
        <div className="section-header">
          <Link2 size={18} className="icon" />
          <h3>URL 정보</h3>
        </div>
        <div className="field-grid">
          <div className="input-group">
            <label>개인정보 처리방침 URL <span className="required">*</span></label>
            <input
              type="url"
              placeholder="https://example.com/privacy"
              value={shared.privacyUrl || ''}
              onChange={e => updateField('privacyUrl', e.target.value)}
            />
          </div>
          <div className="input-group">
            <label>고객지원 URL</label>
            <input
              type="url"
              placeholder="https://example.com/support"
              value={shared.supportUrl || ''}
              onChange={e => updateField('supportUrl', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Screenshots */}
      <div className="section">
        <div className="section-header">
          <ImageIcon size={18} className="icon" />
          <h3>스크린샷 (Phone 1세트)</h3>
          <label htmlFor="screenshot-upload" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto', cursor: 'pointer' }}>
            <Upload size={14} /> 추가
          </label>
          <input
            id="screenshot-upload"
            type="file"
            accept="image/*"
            multiple
            onChange={handleScreenshotUpload}
            style={{ display: 'none' }}
          />
        </div>

        {(shared.screenshots || []).length > 0 ? (
          <div className="screenshot-grid">
            {(shared.screenshots || []).map((ss, idx) => (
              <div key={ss.id} className="screenshot-item">
                <img src={ss.dataUrl} alt={`Screenshot ${idx + 1}`} />
                <button className="remove-btn" onClick={() => removeScreenshot(ss.id)}>
                  <X size={10} />
                </button>
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '4px 8px',
                  background: 'rgba(0,0,0,0.6)',
                  fontSize: '0.625rem',
                  color: 'white',
                  textAlign: 'center',
                }}>
                  {idx + 1}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <label htmlFor="screenshot-upload" style={{ cursor: 'pointer' }}>
            <div className="drop-zone" style={{ minHeight: 150 }}>
              <ImageIcon size={36} className="icon" />
              <p className="text-secondary text-sm">
                스크린샷을 드래그하거나 클릭하여 업로드
              </p>
              <p className="text-muted text-xs">
                권장: iPhone 6.7" (1290 × 2796) · 최소 2장, 최대 10장
              </p>
            </div>
          </label>
        )}
      </div>

      {/* Version Info */}
      <div className="section">
        <div className="section-header">
          <Hash size={18} className="icon" />
          <h3>버전 정보</h3>
        </div>
        <div className="field-grid">
          <div className="input-group">
            <label>Version Name</label>
            <input
              type="text"
              placeholder="1.0.0"
              value={shared.versionName || ''}
              onChange={e => updateField('versionName', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <div className="input-group">
            <label>Version Code (Build Number)</label>
            <input
              type="number"
              placeholder="1"
              value={shared.versionCode || ''}
              onChange={e => updateField('versionCode', parseInt(e.target.value) || '')}
              min={1}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
