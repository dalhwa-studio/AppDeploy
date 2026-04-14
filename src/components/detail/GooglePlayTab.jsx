import React, { useCallback, useState } from 'react';
import {
  PlayCircle, FileText, Image as ImageIcon, Video,
  Shield, Upload, CheckCircle2, AlertCircle, X
} from 'lucide-react';
import { useApp } from '../../hooks/useAppContext';
import CharCounter from '../common/CharCounter';
import { FIELD_LIMITS, TRACKS, TRACK_LABELS } from '../../utils/constants';

export default function GooglePlayTab() {
  const { currentApp, dispatch, addToast, storeAccounts } = useApp();
  const gp = currentApp?.googlePlay || {};

  const updateField = useCallback((path, value) => {
    dispatch({
      type: 'UPDATE_APP_FIELD',
      payload: { id: currentApp.id, path: `googlePlay.${path}`, value },
    });
  }, [currentApp?.id, dispatch]);

  /* ─── Feature Graphic upload ─── */
  const handleFeatureGraphicUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      updateField('featureGraphic', ev.target.result);
      addToast('Feature Graphic이 설정되었습니다.', 'success');
    };
    reader.readAsDataURL(file);
  };

  /* ─── Google Service Account upload ─── */
  const handleServiceAccountUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith('.json')) {
      addToast('JSON 파일을 선택해 주세요.', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed.type !== 'service_account') {
          addToast('유효한 Service Account JSON이 아닙니다.', 'error');
          return;
        }
        dispatch({
          type: 'UPDATE_STORE_ACCOUNTS',
          payload: {
            googlePlay: {
              email: parsed.client_email,
              projectId: parsed.project_id,
              fileName: file.name,
              uploadedAt: new Date().toISOString(),
            },
          },
        });
        addToast(`Google Play 계정 연결됨: ${parsed.client_email}`, 'success');
      } catch {
        addToast('JSON 파싱에 실패했습니다.', 'error');
      }
    };
    reader.readAsText(file);
  };

  if (!currentApp) return null;

  const gpAccount = storeAccounts.googlePlay;

  return (
    <div className="fade-in">
      {/* API Auth */}
      <div className="section">
        <div className="section-header">
          <Shield size={18} className="icon" />
          <h3>API 인증</h3>
        </div>
        <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
          {gpAccount ? (
            <div className="flex items-center gap-md">
              <CheckCircle2 size={20} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-success)' }}>연결됨</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  {gpAccount.email}
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  프로젝트: {gpAccount.projectId} · {gpAccount.fileName}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => dispatch({ type: 'UPDATE_STORE_ACCOUNTS', payload: { googlePlay: null } })}
              >
                <X size={14} /> 해제
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-sm mb-md">
                <AlertCircle size={18} style={{ color: 'var(--color-warning)' }} />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Google Play 서비스 계정이 연결되지 않았습니다
                </span>
              </div>
              <label className="btn btn-google" style={{ cursor: 'pointer' }}>
                <Upload size={16} /> Service Account JSON 업로드
                <input
                  type="file"
                  accept=".json"
                  onChange={handleServiceAccountUpload}
                  style={{ display: 'none' }}
                />
              </label>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Google Cloud Console → IAM → 서비스 계정 → JSON 키 다운로드
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Google Play exclusive metadata */}
      <div className="section">
        <div className="section-header">
          <FileText size={18} className="icon" />
          <h3>Google Play 전용 메타데이터</h3>
        </div>

        <div className="flex flex-col gap-md">
          <div className="input-group">
            <label>Short Description (짧은 설명)</label>
            <input
              type="text"
              placeholder="앱을 한 줄로 소개해 주세요"
              value={gp.shortDescription || ''}
              onChange={e => updateField('shortDescription', e.target.value.slice(0, FIELD_LIMITS.shortDescription))}
              maxLength={FIELD_LIMITS.shortDescription}
            />
            <CharCounter current={(gp.shortDescription || '').length} max={FIELD_LIMITS.shortDescription} />
          </div>

          <div className="input-group">
            <label>Release Notes (변경사항)</label>
            <textarea
              placeholder="이 버전에서 변경된 사항을 설명해 주세요"
              value={gp.releaseNotes || ''}
              onChange={e => updateField('releaseNotes', e.target.value.slice(0, FIELD_LIMITS.googleReleaseNotes))}
              rows={4}
            />
            <CharCounter current={(gp.releaseNotes || '').length} max={FIELD_LIMITS.googleReleaseNotes} />
          </div>

          <div className="input-group">
            <label><Video size={14} /> Video URL (YouTube)</label>
            <input
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={gp.videoUrl || ''}
              onChange={e => updateField('videoUrl', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Feature Graphic */}
      <div className="section">
        <div className="section-header">
          <ImageIcon size={18} className="icon" />
          <h3>Feature Graphic</h3>
        </div>

        {gp.featureGraphic ? (
          <div style={{ position: 'relative', maxWidth: 512, borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <img src={gp.featureGraphic} alt="Feature Graphic" style={{ width: '100%', aspectRatio: '1024/500' }} />
            <button
              className="btn btn-ghost btn-icon"
              style={{
                position: 'absolute', top: 8, right: 8,
                background: 'rgba(0,0,0,0.6)', color: 'white'
              }}
              onClick={() => updateField('featureGraphic', null)}
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <label style={{ cursor: 'pointer' }}>
            <div className="drop-zone" style={{ minHeight: 140, maxWidth: 512 }}>
              <ImageIcon size={32} className="icon" />
              <p className="text-secondary text-sm">Feature Graphic 업로드</p>
              <p className="text-muted text-xs">권장: 1024 × 500 px (JPG/PNG)</p>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={handleFeatureGraphicUpload}
              style={{ display: 'none' }}
            />
          </label>
        )}
      </div>

      {/* Track Selection */}
      <div className="section">
        <div className="section-header">
          <PlayCircle size={18} className="icon" />
          <h3>배포 트랙</h3>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          {Object.entries(TRACK_LABELS).map(([value, label]) => (
            <button
              key={value}
              className={`btn ${gp.track === value ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => updateField('track', value)}
            >
              {label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
          {gp.track === TRACKS.INTERNAL
            ? '내부 테스트: 최대 100명, 심사 없이 즉시 배포'
            : gp.track === TRACKS.PRODUCTION
            ? '프로덕션: Google 심사 후 전체 사용자에게 배포 (1~3일)'
            : '테스트 트랙: 제한된 사용자에게 먼저 배포'}
        </p>
      </div>
    </div>
  );
}
