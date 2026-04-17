import sharp from 'sharp';
import { loadCredential } from './credentialManager.js';
import * as gplay from './googlePlayApi.js';
import * as apple from './appStoreApi.js';
import { toAppStoreLocale, toGooglePlayLocale, DEFAULT_LOCALE } from './localeMapper.js';

// App Store Connect requires screenshots at exact pixel dimensions per display type.
// 6.5": iPhone XS Max / 11 Pro Max / 11 / XR.
const APPLE_65_PORTRAIT = { width: 1242, height: 2688 };
const APPLE_65_LANDSCAPE = { width: 2688, height: 1242 };

/**
 * Resize a buffer to the exact 6.5" iPhone screenshot dimensions expected by
 * App Store Connect. Orientation is chosen from the source; content is fit with
 * black padding so nothing is cropped. Alpha channel is flattened and output is
 * forced to sRGB — Apple rejects screenshots with alpha or non-RGB color spaces
 * (usually shown as a red ⚠ frame in App Store Connect after upload).
 */
async function resizeToApple65(buffer) {
  const meta = await sharp(buffer).metadata();
  const isLandscape = (meta.width || 0) > (meta.height || 0);
  const target = isLandscape ? APPLE_65_LANDSCAPE : APPLE_65_PORTRAIT;
  return sharp(buffer)
    .resize(target.width, target.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0 },
    })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .toColorspace('srgb')
    .png({ compressionLevel: 9, force: true })
    .toBuffer();
}

/**
 * Build metadataByLocale from either a flat metadata object (legacy, single locale)
 * or a provided metadataByLocale map.
 */
function normalizeLocaleMap({ metadata, metadataByLocale, defaultLocale }) {
  if (metadataByLocale && typeof metadataByLocale === 'object') return metadataByLocale;
  if (!metadata) return {};
  return { [defaultLocale || DEFAULT_LOCALE]: metadata };
}

/**
 * Decode an array of { dataUrl, fileName } into { buffer, fileName } entries.
 * Entries without a dataUrl are skipped.
 */
function decodeScreenshots(screenshots) {
  if (!Array.isArray(screenshots)) return [];
  const out = [];
  screenshots.forEach((s, idx) => {
    if (!s?.dataUrl) return;
    const base64 = s.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) return;
    out.push({ buffer, fileName: s.fileName || `screenshot_${idx + 1}.png` });
  });
  return out;
}

/**
 * Pick the screenshots to upload for a given locale.
 * Uses per-locale screenshots if provided; otherwise falls back to the top-level list.
 */
function pickLocaleScreenshots(m, topLevelFallback) {
  if (Array.isArray(m?.screenshots) && m.screenshots.length > 0) return m.screenshots;
  return Array.isArray(topLevelFallback) ? topLevelFallback : [];
}

/**
 * Create a cache of resized Apple screenshots keyed by stable id so that
 * identical images shared across locales (via shared fallback) are processed once.
 */
function createAppleResizeCache(log) {
  const cache = new Map();
  return async function getResized(raw) {
    const key = raw?.id || `${raw?.fileName || ''}:${(raw?.dataUrl || '').length}`;
    if (cache.has(key)) return cache.get(key);
    const decoded = decodeScreenshots([raw])[0];
    if (!decoded) return null;
    const buffer = await resizeToApple65(decoded.buffer);
    const meta = await sharp(buffer).metadata();
    const base = (decoded.fileName || 'screenshot').replace(/\.[^.]+$/, '');
    const line = `${base}: ${meta.width}x${meta.height}, ${buffer.length} bytes, alpha=${meta.hasAlpha}`;
    console.log(`[Apple Screenshot] ${line}`);
    log?.('debug', `리사이즈 ${line}`);
    const result = { buffer, fileName: `${base}_65.png` };
    cache.set(key, result);
    return result;
  };
}

/**
 * Sync metadata directly to Google Play via API.
 * Creates one edit, updates every locale's listing, and commits once.
 */
export async function syncMetadataToGoogle({
  credentialId,
  packageName,
  metadata,
  metadataByLocale,
  defaultLocale,
  encryptionKey,
  screenshots,
  onLog,
}) {
  if (!packageName) throw new Error('Android Package Name이 설정되지 않았습니다.');

  const log = (level, message) => onLog?.(level, message);
  const byLocale = normalizeLocaleMap({ metadata, metadataByLocale, defaultLocale });
  const locales = Object.keys(byLocale);
  if (locales.length === 0) throw new Error('업로드할 메타데이터가 없습니다.');

  log('info', `Google Play 동기화 시작 — ${locales.length}개 로케일 (${packageName})`);
  const serviceAccountJson = loadCredential(credentialId, encryptionKey);
  const client = gplay.createClient(serviceAccountJson);

  log('info', 'Edit 세션 생성 중...');
  const editId = await gplay.createEdit(client, packageName);
  log('info', `Edit ID: ${editId}`);

  try {
    const perLocale = [];
    for (const canonicalLocale of locales) {
      const m = byLocale[canonicalLocale] || {};
      const language = toGooglePlayLocale(canonicalLocale);
      const { title, shortDescription, fullDescription, description } = m;

      log('info', `[${language}] 메타데이터 업데이트 중...`);
      await gplay.updateListing(client, packageName, editId, language, {
        title: title || undefined,
        shortDescription: shortDescription || undefined,
        fullDescription: (fullDescription || description) || undefined,
      });

      const entry = {
        locale: canonicalLocale,
        language,
        updated: Object.keys(m).filter(k => m[k] && k !== 'screenshots'),
      };

      const localeSources = pickLocaleScreenshots(m, screenshots);
      const decoded = decodeScreenshots(localeSources);
      if (decoded.length > 0) {
        log('info', `[${language}] 스크린샷 ${decoded.length}장 업로드 중...`);
        const uploaded = await gplay.replacePhoneScreenshots(
          client, packageName, editId, language, decoded
        );
        entry.screenshotsUploaded = uploaded;
        log('success', `[${language}] 스크린샷 ${uploaded}장 완료`);
      }

      perLocale.push(entry);
    }

    log('info', 'Edit 커밋 중...');
    await gplay.commitEdit(client, packageName, editId);
    log('success', 'Google Play 커밋 완료');

    const totalShots = perLocale.reduce((n, p) => n + (p.screenshotsUploaded || 0), 0);
    let message = `Google Play 스토어 메타데이터가 ${perLocale.length}개 로케일에 업데이트되었습니다.`;
    if (totalShots > 0) message += ` (스크린샷 ${totalShots}장 업로드됨)`;

    return { message, perLocale };
  } catch (err) {
    log('error', `실패 — edit 롤백: ${err.message}`);
    await gplay.deleteEdit(client, packageName, editId);
    throw err;
  }
}

/**
 * Sync metadata directly to App Store Connect via API.
 * Finds one editable version and updates localizations for every provided locale.
 */
export async function syncMetadataToApple({
  credentialId,
  bundleId,
  metadata,
  metadataByLocale,
  defaultLocale,
  versionString,
  encryptionKey,
  screenshots,
  onLog,
}) {
  if (!bundleId) throw new Error('iOS Bundle ID가 설정되지 않았습니다.');

  const log = (level, message) => onLog?.(level, message);
  const byLocale = normalizeLocaleMap({ metadata, metadataByLocale, defaultLocale });
  const locales = Object.keys(byLocale);
  if (locales.length === 0) throw new Error('업로드할 메타데이터가 없습니다.');

  log('info', `App Store 동기화 시작 — ${locales.length}개 로케일 (${bundleId})`);
  const credentialRaw = loadCredential(credentialId, encryptionKey);
  const credential = JSON.parse(credentialRaw);
  const { issuerId, keyId, privateKey } = credential;

  log('info', '앱 조회 중...');
  const jwt1 = apple.generateJWT(issuerId, keyId, privateKey);
  const app = await apple.getApp(jwt1, bundleId);
  log('info', `앱 찾음: ${app.name} (id=${app.id})`);

  const vStr = versionString || metadata?.versionString || '1.0.0';
  log('info', `버전 확인/생성: ${vStr}`);
  const jwt2 = apple.generateJWT(issuerId, keyId, privateKey);
  const version = await apple.getOrCreateVersion(jwt2, app.id, vStr);
  log('info', `버전 id=${version.id}, state=${version.state}`);

  // Cache resized buffers by screenshot id so duplicates (via shared fallback) are processed once.
  const getResized = createAppleResizeCache(log);

  const perLocale = [];
  for (const canonicalLocale of locales) {
    const m = byLocale[canonicalLocale] || {};
    const appleLocale = toAppStoreLocale(canonicalLocale);

    try {
      log('info', `[${appleLocale}] 메타데이터 업데이트 중...`);
      const jwt = apple.generateJWT(issuerId, keyId, privateKey);
      const result = await apple.updateVersionLocalization(jwt, version.id, appleLocale, {
        description: m.description,
        keywords: m.keywords,
        whatsNew: m.whatsNew,
        promotionalText: m.promotionalText,
        marketingUrl: m.marketingUrl,
      });
      const entry = {
        locale: canonicalLocale,
        appleLocale,
        updated: result?.updated || [],
        skipped: result?.skipped || [],
      };
      if (entry.updated.length > 0) log('success', `[${appleLocale}] 텍스트 필드 ${entry.updated.length}개 업데이트`);
      if (entry.skipped.length > 0) log('warn', `[${appleLocale}] 편집 불가 필드 ${entry.skipped.length}개 건너뜀`);

      const localeSources = pickLocaleScreenshots(m, screenshots);
      if (localeSources.length > 0 && result?.localizationId) {
        try {
          log('info', `[${appleLocale}] 스크린샷 ${localeSources.length}장 리사이즈...`);
          const resized = [];
          for (const raw of localeSources) {
            const r = await getResized(raw);
            if (r) resized.push(r);
          }
          if (resized.length > 0) {
            log('info', `[${appleLocale}] 스크린샷 업로드 중... (iPhone 6.5")`);
            const jwtShots = apple.generateJWT(issuerId, keyId, privateKey);
            const { uploaded } = await apple.replaceScreenshots(
              jwtShots, result.localizationId, 'APP_IPHONE_65', resized
            );
            entry.screenshotsUploaded = uploaded;
            log('success', `[${appleLocale}] 스크린샷 ${uploaded}장 완료`);
          }
        } catch (shotErr) {
          entry.screenshotError = shotErr.message;
          log('error', `[${appleLocale}] 스크린샷 실패: ${shotErr.message}`);
        }
      }

      perLocale.push(entry);
    } catch (err) {
      log('error', `[${appleLocale}] 실패: ${err.message}`);
      perLocale.push({ locale: canonicalLocale, appleLocale, error: err.message });
    }
  }

  const totalUpdated = perLocale.reduce((n, p) => n + (p.updated?.length || 0), 0);
  const totalShots = perLocale.reduce((n, p) => n + (p.screenshotsUploaded || 0), 0);
  const hasSkipped = perLocale.some(p => p.skipped?.length);
  const hasError = perLocale.some(p => p.error);
  const hasShotError = perLocale.some(p => p.screenshotError);

  let message = `App Store 메타데이터가 ${perLocale.length}개 로케일에 업데이트되었습니다.`;
  if (totalShots > 0) message += ` (iPhone 6.5" 스크린샷 ${totalShots}장 업로드됨)`;
  if (hasShotError) message += ' — 스크린샷 업로드 일부 실패';
  if (hasError) message += ' (일부 로케일 실패)';
  else if (hasSkipped) message += ` (현재 버전 상태(${version.state})에서는 일부 필드가 편집 불가능하여 건너뜀)`;

  return {
    message,
    versionId: version.id,
    versionString: version.versionString,
    versionState: version.state,
    totalUpdated,
    totalScreenshotsUploaded: totalShots,
    perLocale,
  };
}
