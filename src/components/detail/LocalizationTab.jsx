import React, { useState, useMemo, useEffect } from 'react';
import {
  Globe, Sparkles, Languages, Plus, X, RefreshCw, Upload,
  CheckCircle2, AlertCircle, Edit3, PlayCircle, Apple,
  Image as ImageIcon, RotateCcw
} from 'lucide-react';
import { useApp } from '../../hooks/useAppContext';
import { API_BASE, FIELD_LIMITS } from '../../utils/constants';
import { LOCALE_PRESETS, DEFAULT_LOCALE, getLocaleLabel } from '../../utils/locales';
import CharCounter from '../common/CharCounter';
import SyncLogPanel, { useSyncLog } from '../common/SyncLogPanel';

const EDITABLE_FIELDS = [
  { key: 'title', label: 'Title', limit: FIELD_LIMITS.appName, rows: 1 },
  { key: 'subtitle', label: 'Subtitle (App Store)', limit: FIELD_LIMITS.subtitle, rows: 1 },
  { key: 'shortDescription', label: 'Short Description (Google Play)', limit: FIELD_LIMITS.shortDescription, rows: 2 },
  { key: 'description', label: 'Description', limit: FIELD_LIMITS.description, rows: 6 },
  { key: 'keywords', label: 'Keywords (App Store)', limit: FIELD_LIMITS.keywords, rows: 1 },
  { key: 'promotionalText', label: 'Promotional Text (App Store)', limit: FIELD_LIMITS.promotionalText, rows: 2 },
  { key: 'whatsNew', label: "What's New / Release Notes", limit: FIELD_LIMITS.whatsNew, rows: 4 },
];

export default function LocalizationTab() {
  const { currentApp, dispatch, addToast, storeAccounts } = useApp();
  const [provider, setProvider] = useState('anthropic');
  const [llmStatus, setLlmStatus] = useState({ anthropic: null, openai: null, gemini: null });
  const [customLocale, setCustomLocale] = useState('');
  const [generating, setGenerating] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [editingLocale, setEditingLocale] = useState(null);
  const { socketId, logs, isActive, clear } = useSyncLog();

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/llm-credential`)
      .then(r => r.json())
      .then(data => {
        if (cancelled || !data.success) return;
        const status = { anthropic: data.anthropic, openai: data.openai, gemini: data.gemini };
        setLlmStatus(status);
        setProvider(prev => (status[prev] ? prev : (['anthropic', 'openai', 'gemini'].find(p => status[p]) || prev)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!currentApp) return null;

  const shared = currentApp.shared || {};
  const appStore = currentApp.appStore || {};
  const googlePlay = currentApp.googlePlay || {};
  const targetLocales = currentApp.targetLocales || [];
  const localesData = currentApp.locales || {};
  const defaultLocale = currentApp.defaultLocale || DEFAULT_LOCALE;

  const sourceMetadata = useMemo(() => ({
    title: shared.appName || '',
    subtitle: appStore.subtitle || '',
    shortDescription: googlePlay.shortDescription || '',
    description: shared.description || '',
    keywords: appStore.keywords || '',
    promotionalText: appStore.promotionalText || '',
    whatsNew: appStore.whatsNew || '',
  }), [shared, appStore, googlePlay]);

  const updateField = (path, value) => {
    dispatch({ type: 'UPDATE_APP_FIELD', payload: { id: currentApp.id, path, value } });
  };

  const toggleLocale = (code) => {
    const next = targetLocales.includes(code)
      ? targetLocales.filter(c => c !== code)
      : [...targetLocales, code];
    updateField('targetLocales', next);
  };

  const addCustomLocale = () => {
    const code = customLocale.trim();
    if (!code) return;
    if (targetLocales.includes(code) || code === defaultLocale) {
      addToast('이미 추가된 로케일입니다.', 'warning');
      return;
    }
    updateField('targetLocales', [...targetLocales, code]);
    setCustomLocale('');
  };

  const removeLocale = (code) => {
    updateField('targetLocales', targetLocales.filter(c => c !== code));
    const nextLocales = { ...localesData };
    delete nextLocales[code];
    updateField('locales', nextLocales);
    if (editingLocale === code) setEditingLocale(null);
  };

  const generateOne = async (locale) => {
    if (localesData[locale]?.edited) {
      if (!window.confirm(`${getLocaleLabel(locale)} 메타데이터는 수동 편집된 상태입니다. 덮어쓰시겠습니까?`)) return;
    }
    setGenerating(g => ({ ...g, [locale]: true }));
    try {
      const res = await fetch(`${API_BASE}/metadata/generate-aso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          store: 'both',
          sourceLocale: defaultLocale,
          sourceMetadata,
          targetLocales: [locale],
        }),
      });
      const data = await res.json();
      if (!data.success) {
        addToast(`${getLocaleLabel(locale)}: ${data.error}`, 'error');
        return;
      }
      const result = data.results[locale];
      if (result?.error) {
        addToast(`${getLocaleLabel(locale)}: ${result.error}`, 'error');
        return;
      }
      updateField('locales', { ...localesData, [locale]: { ...result, edited: false } });
      addToast(`${getLocaleLabel(locale)} 생성 완료`, 'success');
    } catch (err) {
      addToast(`요청 실패: ${err.message}`, 'error');
    } finally {
      setGenerating(g => ({ ...g, [locale]: false }));
    }
  };

  const generateAll = async () => {
    const pending = targetLocales.filter(l => !localesData[l]?.edited || window.confirm(`${getLocaleLabel(l)} 메타데이터는 수동 편집된 상태입니다. 덮어쓰시겠습니까?`));
    if (pending.length === 0) {
      addToast('생성할 대상 로케일이 없습니다.', 'warning');
      return;
    }
    const loadingMap = Object.fromEntries(pending.map(l => [l, true]));
    setGenerating(g => ({ ...g, ...loadingMap }));
    try {
      const res = await fetch(`${API_BASE}/metadata/generate-aso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          store: 'both',
          sourceLocale: defaultLocale,
          sourceMetadata,
          targetLocales: pending,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        addToast(`요청 실패: ${data.error}`, 'error');
        return;
      }
      const nextLocales = { ...localesData };
      let ok = 0, fail = 0;
      for (const locale of pending) {
        const r = data.results[locale];
        if (r?.error) { fail++; addToast(`${locale}: ${r.error}`, 'error'); }
        else { nextLocales[locale] = { ...r, edited: false }; ok++; }
      }
      updateField('locales', nextLocales);
      addToast(`${ok}개 성공, ${fail}개 실패`, ok > 0 ? 'success' : 'error');
    } catch (err) {
      addToast(`요청 실패: ${err.message}`, 'error');
    } finally {
      setGenerating({});
    }
  };

  const editLocaleField = (locale, field, value) => {
    const current = localesData[locale] || {};
    const limit = FIELD_LIMITS[field === 'title' ? 'appName' : field];
    const capped = limit && typeof value === 'string' ? value.slice(0, limit) : value;
    updateField('locales', {
      ...localesData,
      [locale]: { ...current, [field]: capped, edited: true },
    });
  };

  const setLocaleScreenshots = (locale, screenshots) => {
    const current = localesData[locale] || {};
    updateField('locales', {
      ...localesData,
      [locale]: { ...current, screenshots },
    });
  };

  const handleLocaleScreenshotUpload = (locale, e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const next = [...((localesData[locale]?.screenshots) || [])];
    let loaded = 0;
    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        next.push({
          id: crypto.randomUUID(),
          dataUrl: ev.target.result,
          fileName: file.name,
        });
        loaded++;
        if (loaded === files.length) {
          setLocaleScreenshots(locale, next);
          addToast(`${getLocaleLabel(locale)}에 ${loaded}장 추가됨`, 'success');
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeLocaleScreenshot = (locale, id) => {
    const current = localesData[locale]?.screenshots || [];
    setLocaleScreenshots(locale, current.filter(s => s.id !== id));
  };

  const resetLocaleScreenshots = (locale) => {
    setLocaleScreenshots(locale, []);
    addToast(`${getLocaleLabel(locale)} 스크린샷을 shared로 되돌렸습니다.`, 'success');
  };

  const syncToStore = async (store) => {
    const connected = store === 'google_play' ? storeAccounts.googlePlay : storeAccounts.appStore;
    if (!connected) {
      addToast(`${store === 'google_play' ? 'Google Play' : 'App Store'} 자격증명이 연결되지 않았습니다.`, 'error');
      return;
    }

    const sharedShots = shared.screenshots || [];
    const pickShots = (localeShots) =>
      (Array.isArray(localeShots) && localeShots.length > 0) ? localeShots : sharedShots;

    const metadataByLocale = {
      [defaultLocale]: { ...sourceMetadata, screenshots: sharedShots },
      ...Object.fromEntries(
        targetLocales
          .filter(l => localesData[l] && !localesData[l].error)
          .map(l => [l, { ...localesData[l], screenshots: pickShots(localesData[l]?.screenshots) }])
      ),
    };
    if (Object.keys(metadataByLocale).length === 0) {
      addToast('동기화할 로케일이 없습니다.', 'warning');
      return;
    }

    setSyncing(store);
    try {
      const res = await fetch(`${API_BASE}/sync/metadata/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store,
          credentialId: connected.credentialId,
          packageName: currentApp.androidPackageName,
          bundleId: currentApp.iosBundleId,
          metadataByLocale,
          defaultLocale,
          versionString: shared.versionName || '1.0.0',
          socketId,
        }),
      });
      const data = await res.json();
      addToast(data.success ? data.message : data.error, data.success ? 'success' : 'error');
    } catch (err) {
      addToast(`동기화 실패: ${err.message}`, 'error');
    }
    setSyncing(null);
  };

  return (
    <div className="fade-in">
      {/* Provider & Source */}
      <div className="section">
        <div className="section-header">
          <Sparkles size={18} className="icon" />
          <h3>AI 자동 생성 설정</h3>
        </div>
        <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
          <div className="flex items-center gap-md" style={{ flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>LLM Provider</label>
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
            >
              <option value="anthropic">Anthropic Claude {llmStatus.anthropic ? '✓' : '(미연결)'}</option>
              <option value="openai">OpenAI GPT {llmStatus.openai ? '✓' : '(미연결)'}</option>
              <option value="gemini">Google Gemini (무료) {llmStatus.gemini ? '✓' : '(미연결)'}</option>
            </select>
            <div style={{ fontSize: '0.75rem', color: llmStatus[provider] ? 'var(--text-muted)' : 'var(--color-warning)' }}>
              기본 언어: <strong>{getLocaleLabel(defaultLocale)}</strong>
              {!llmStatus[provider] && <> · ⚠ 선택한 provider에 API Key가 설정되지 않았습니다 (설정 → AI 서비스)</>}
            </div>
          </div>
        </div>
      </div>

      {/* Target Locales */}
      <div className="section">
        <div className="section-header">
          <Globe size={18} className="icon" />
          <h3>대상 국가 (Locale)</h3>
        </div>
        <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {LOCALE_PRESETS.map(p => {
              const selected = targetLocales.includes(p.code);
              return (
                <label
                  key={p.code}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                    background: selected ? 'var(--bg-elevated)' : 'var(--bg-input)',
                    border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
                    cursor: 'pointer', fontSize: '0.8125rem',
                  }}
                >
                  <input type="checkbox" checked={selected} onChange={() => toggleLocale(p.code)} />
                  <span>{p.flag} {p.label}</span>
                </label>
              );
            })}
          </div>

          <div style={{ marginTop: 'var(--space-md)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="직접 추가 (예: nl-NL)"
              value={customLocale}
              onChange={e => setCustomLocale(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomLocale()}
              style={{ flex: 1, maxWidth: 240, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
            />
            <button className="btn btn-secondary btn-sm" onClick={addCustomLocale}>
              <Plus size={14} /> 추가
            </button>
          </div>

          {targetLocales.length > 0 && (
            <div style={{ marginTop: 'var(--space-md)' }}>
              <button
                className="btn btn-primary"
                onClick={generateAll}
                disabled={Object.values(generating).some(Boolean)}
              >
                {Object.values(generating).some(Boolean)
                  ? <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> 생성 중...</>
                  : <><Sparkles size={16} /> 선택 locale 전부 자동 생성 ({targetLocales.length}개)</>
                }
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Locale results */}
      {targetLocales.length > 0 && (
        <div className="section">
          <div className="section-header">
            <Languages size={18} className="icon" />
            <h3>생성 결과 / 편집</h3>
          </div>

          {/* Locale pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-md)' }}>
            {targetLocales.map(code => {
              const data = localesData[code];
              const isGen = generating[code];
              const isActive = editingLocale === code;
              return (
                <div
                  key={code}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: isActive ? 'var(--color-primary)' : 'var(--bg-elevated)',
                    color: isActive ? '#fff' : 'var(--text-primary)',
                    border: `1px solid ${isActive ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
                    fontSize: '0.8125rem',
                  }}
                >
                  <button
                    onClick={() => setEditingLocale(isActive ? null : code)}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {getLocaleLabel(code)}
                    {data?.edited && <Edit3 size={12} />}
                    {data && !data.error && !data.edited && <CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} />}
                    {data?.error && <AlertCircle size={12} style={{ color: 'var(--color-error)' }} />}
                  </button>
                  <button
                    onClick={() => generateOne(code)}
                    disabled={isGen}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
                    title="이 locale만 재생성"
                  >
                    <RefreshCw size={12} style={{ animation: isGen ? 'spin 1s linear infinite' : 'none' }} />
                  </button>
                  <button
                    onClick={() => removeLocale(code)}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
                    title="제거"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Editor */}
          {editingLocale && localesData[editingLocale] && !localesData[editingLocale].error && (
            <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
                {localesData[editingLocale].generatedBy && `생성: ${localesData[editingLocale].generatedBy} · `}
                {localesData[editingLocale].generatedAt && new Date(localesData[editingLocale].generatedAt).toLocaleString('ko-KR')}
                {localesData[editingLocale].edited && <span style={{ color: 'var(--color-warning)', marginLeft: 8 }}>수동 편집됨</span>}
              </div>
              <div className="flex flex-col gap-md">
                {EDITABLE_FIELDS.map(f => {
                  const value = localesData[editingLocale][f.key] || '';
                  return (
                    <div key={f.key} className="input-group">
                      <label>{f.label}</label>
                      {f.rows === 1 ? (
                        <input
                          type="text"
                          value={value}
                          onChange={e => editLocaleField(editingLocale, f.key, e.target.value)}
                          maxLength={f.limit}
                        />
                      ) : (
                        <textarea
                          rows={f.rows}
                          value={value}
                          onChange={e => editLocaleField(editingLocale, f.key, e.target.value)}
                        />
                      )}
                      <CharCounter current={value.length} max={f.limit} />
                    </div>
                  );
                })}

                {/* Per-locale screenshots */}
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-sm)' }}>
                    <ImageIcon size={16} className="icon" />
                    <strong style={{ fontSize: '0.875rem' }}>스크린샷</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      (이 로케일 전용. 비워두면 shared 사용)
                    </span>
                  </div>

                  {(() => {
                    const localeShots = localesData[editingLocale]?.screenshots || [];
                    const sharedCount = (shared.screenshots || []).length;
                    const inputId = `loc-ss-upload-${editingLocale}`;

                    if (localeShots.length === 0) {
                      return (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: 'var(--space-md)',
                          background: 'var(--bg-input)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px dashed var(--border-subtle)',
                        }}>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', flex: 1 }}>
                            shared 스크린샷 사용 중 <strong>({sharedCount}장)</strong>
                          </div>
                          <label htmlFor={inputId} className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                            <Upload size={14} /> 이 로케일 전용 업로드
                          </label>
                          <input
                            id={inputId}
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: 'none' }}
                            onChange={e => handleLocaleScreenshotUpload(editingLocale, e)}
                          />
                        </div>
                      );
                    }

                    return (
                      <div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-sm)' }}>
                          {localeShots.map(s => (
                            <div key={s.id} style={{ position: 'relative', width: 100, height: 180, borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}>
                              <img src={s.dataUrl} alt={s.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <button
                                onClick={() => removeLocaleScreenshot(editingLocale, s.id)}
                                style={{
                                  position: 'absolute', top: 4, right: 4,
                                  background: 'rgba(0,0,0,0.7)', border: 'none',
                                  color: '#fff', borderRadius: '50%',
                                  width: 20, height: 20, cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                                title="삭제"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                          <label htmlFor={inputId} style={{
                            width: 100, height: 180, borderRadius: 'var(--radius-sm)',
                            border: '2px dashed var(--border-subtle)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-muted)',
                          }}>
                            <Plus size={24} />
                          </label>
                          <input
                            id={inputId}
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: 'none' }}
                            onChange={e => handleLocaleScreenshotUpload(editingLocale, e)}
                          />
                        </div>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => resetLocaleScreenshots(editingLocale)}
                        >
                          <RotateCcw size={14} /> shared로 되돌리기 ({sharedCount}장)
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {editingLocale && localesData[editingLocale]?.error && (
            <div className="glass-card" style={{ padding: 'var(--space-md)', borderLeft: '3px solid var(--color-error)' }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--color-error)' }}>
                <AlertCircle size={14} style={{ verticalAlign: 'middle' }} /> 생성 실패: {localesData[editingLocale].error}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sync actions */}
      <div className="section">
        <div className="section-header">
          <Upload size={18} className="icon" />
          <h3>스토어에 동기화</h3>
        </div>
        <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-md)' }}>
            기본 로케일({getLocaleLabel(defaultLocale)})과 생성된 모든 타겟 로케일이 함께 업로드됩니다.
          </div>
          <div className="flex items-center gap-md" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn btn-google"
              disabled={syncing === 'google_play' || !storeAccounts.googlePlay || !currentApp.androidPackageName}
              onClick={() => syncToStore('google_play')}
            >
              <PlayCircle size={16} />
              {syncing === 'google_play' ? '동기화 중...' : 'Google Play에 동기화'}
            </button>
            <button
              className="btn btn-apple"
              disabled={syncing === 'app_store' || !storeAccounts.appStore || !currentApp.iosBundleId}
              onClick={() => syncToStore('app_store')}
            >
              <Apple size={16} />
              {syncing === 'app_store' ? '동기화 중...' : 'App Store에 동기화'}
            </button>
          </div>
          <SyncLogPanel logs={logs} isActive={isActive} onClear={clear} />
        </div>
      </div>
    </div>
  );
}
