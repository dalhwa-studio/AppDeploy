import React, { useCallback } from 'react';
import {
  Apple, FileText, Shield, Upload, CheckCircle2,
  AlertCircle, X, User, MessageSquare
} from 'lucide-react';
import { useApp } from '../../hooks/useAppContext';
import CharCounter from '../common/CharCounter';
import { FIELD_LIMITS } from '../../utils/constants';

export default function AppStoreTab() {
  const { currentApp, dispatch, addToast, storeAccounts } = useApp();
  const as = currentApp?.appStore || {};

  const updateField = useCallback((path, value) => {
    dispatch({
      type: 'UPDATE_APP_FIELD',
      payload: { id: currentApp.id, path: `appStore.${path}`, value },
    });
  }, [currentApp?.id, dispatch]);

  /* ─── Apple API Key upload (.p8) ─── */
  const [issuerId, setIssuerId] = React.useState('');
  const [keyId, setKeyId] = React.useState('');

  const handleP8Upload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      if (!content.includes('BEGIN PRIVATE KEY')) {
        addToast('.p8 파일에 PRIVATE KEY가 포함되어 있지 않습니다.', 'error');
        return;
      }
      if (!issuerId || !keyId) {
        addToast('Issuer ID와 Key ID를 먼저 입력해 주세요.', 'warning');
        return;
      }
      dispatch({
        type: 'UPDATE_STORE_ACCOUNTS',
        payload: {
          appStore: {
            issuerId,
            keyId,
            fileName: file.name,
            uploadedAt: new Date().toISOString(),
          },
        },
      });
      addToast('App Store Connect API Key가 연결되었습니다.', 'success');
    };
    reader.readAsText(file);
  };

  if (!currentApp) return null;

  const asAccount = storeAccounts.appStore;

  return (
    <div className="fade-in">
      {/* API Auth */}
      <div className="section">
        <div className="section-header">
          <Shield size={18} className="icon" />
          <h3>API 인증</h3>
        </div>
        <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
          {asAccount ? (
            <div className="flex items-center gap-md">
              <CheckCircle2 size={20} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-success)' }}>연결됨</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Key ID: <span style={{ fontFamily: 'var(--font-mono)' }}>{asAccount.keyId}</span>
                </div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Issuer: {asAccount.issuerId} · {asAccount.fileName}
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => dispatch({ type: 'UPDATE_STORE_ACCOUNTS', payload: { appStore: null } })}
              >
                <X size={14} /> 해제
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-md">
              <div className="flex items-center gap-sm">
                <AlertCircle size={18} style={{ color: 'var(--color-warning)' }} />
                <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  App Store Connect API Key가 연결되지 않았습니다
                </span>
              </div>
              <div className="field-grid">
                <div className="input-group">
                  <label>Issuer ID</label>
                  <input
                    type="text"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={issuerId}
                    onChange={e => setIssuerId(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
                  />
                </div>
                <div className="input-group">
                  <label>Key ID</label>
                  <input
                    type="text"
                    placeholder="XXXXXXXXXX"
                    value={keyId}
                    onChange={e => setKeyId(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
                  />
                </div>
              </div>
              <label className="btn btn-apple" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>
                <Upload size={16} /> .p8 Private Key 업로드
                <input
                  type="file"
                  accept=".p8"
                  onChange={handleP8Upload}
                  style={{ display: 'none' }}
                />
              </label>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                App Store Connect → Users and Access → Keys → API Key 생성
              </p>
            </div>
          )}
        </div>
      </div>

      {/* App Store metadata */}
      <div className="section">
        <div className="section-header">
          <FileText size={18} className="icon" />
          <h3>App Store 전용 메타데이터</h3>
        </div>

        <div className="flex flex-col gap-md">
          <div className="field-grid">
            <div className="input-group">
              <label>Subtitle (부제목)</label>
              <input
                type="text"
                placeholder="앱의 부제목"
                value={as.subtitle || ''}
                onChange={e => updateField('subtitle', e.target.value.slice(0, FIELD_LIMITS.subtitle))}
                maxLength={FIELD_LIMITS.subtitle}
              />
              <CharCounter current={(as.subtitle || '').length} max={FIELD_LIMITS.subtitle} />
            </div>
            <div className="input-group">
              <label>Copyright</label>
              <input
                type="text"
                placeholder="© 2026 Company Name"
                value={as.copyright || ''}
                onChange={e => updateField('copyright', e.target.value)}
              />
            </div>
          </div>

          <div className="input-group">
            <label>Keywords (키워드, 쉼표로 구분)</label>
            <input
              type="text"
              placeholder="앱,스토어,배포,자동화"
              value={as.keywords || ''}
              onChange={e => updateField('keywords', e.target.value.slice(0, FIELD_LIMITS.keywords))}
              maxLength={FIELD_LIMITS.keywords}
            />
            <CharCounter current={(as.keywords || '').length} max={FIELD_LIMITS.keywords} />
          </div>

          <div className="input-group">
            <label>Promotional Text (프로모션 텍스트)</label>
            <textarea
              placeholder="심사 없이 언제든 수정 가능한 프로모션 문구"
              value={as.promotionalText || ''}
              onChange={e => updateField('promotionalText', e.target.value.slice(0, FIELD_LIMITS.promotionalText))}
              rows={2}
            />
            <CharCounter current={(as.promotionalText || '').length} max={FIELD_LIMITS.promotionalText} />
          </div>

          <div className="input-group">
            <label>What's New (업데이트 노트)</label>
            <textarea
              placeholder="이 버전에서 새로워진 점을 설명해 주세요"
              value={as.whatsNew || ''}
              onChange={e => updateField('whatsNew', e.target.value.slice(0, FIELD_LIMITS.whatsNew))}
              rows={4}
            />
            <CharCounter current={(as.whatsNew || '').length} max={FIELD_LIMITS.whatsNew} />
          </div>

          <div className="input-group">
            <label>Marketing URL</label>
            <input
              type="url"
              placeholder="https://example.com"
              value={as.marketingUrl || ''}
              onChange={e => updateField('marketingUrl', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* App Review Info */}
      <div className="section">
        <div className="section-header">
          <User size={18} className="icon" />
          <h3>App Review 정보</h3>
        </div>

        <div className="flex flex-col gap-md">
          <div className="field-grid">
            <div className="input-group">
              <label>담당자 이름</label>
              <input
                type="text"
                placeholder="홍길동"
                value={as.reviewContact?.firstName || ''}
                onChange={e => updateField('reviewContact', { ...(as.reviewContact || {}), firstName: e.target.value })}
              />
            </div>
            <div className="input-group">
              <label>연락처 전화</label>
              <input
                type="text"
                placeholder="+82-10-1234-5678"
                value={as.reviewContact?.phone || ''}
                onChange={e => updateField('reviewContact', { ...(as.reviewContact || {}), phone: e.target.value })}
              />
            </div>
          </div>
          <div className="input-group">
            <label>연락처 이메일</label>
            <input
              type="email"
              placeholder="review@example.com"
              value={as.reviewContact?.email || ''}
              onChange={e => updateField('reviewContact', { ...(as.reviewContact || {}), email: e.target.value })}
            />
          </div>

          <div className="input-group">
            <label><MessageSquare size={14} /> 심사 노트</label>
            <textarea
              placeholder="심사원에게 전달할 추가 정보 (로그인 방법, 특수 기능 설명 등)"
              value={as.reviewNotes || ''}
              onChange={e => updateField('reviewNotes', e.target.value)}
              rows={3}
            />
          </div>

          <div style={{
            padding: 'var(--space-md)',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)',
          }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>
              데모 계정 (선택사항)
            </label>
            <div className="field-grid">
              <div className="input-group">
                <label style={{ fontSize: '0.75rem' }}>ID</label>
                <input
                  type="text"
                  placeholder="demo@example.com"
                  value={as.demoAccount?.username || ''}
                  onChange={e => updateField('demoAccount', { ...(as.demoAccount || {}), username: e.target.value })}
                />
              </div>
              <div className="input-group">
                <label style={{ fontSize: '0.75rem' }}>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={as.demoAccount?.password || ''}
                  onChange={e => updateField('demoAccount', { ...(as.demoAccount || {}), password: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
