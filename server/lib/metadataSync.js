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
 * black padding so nothing is cropped.
 */
async function resizeToApple65(buffer) {
  const meta = await sharp(buffer).metadata();
  const isLandscape = (meta.width || 0) > (meta.height || 0);
  const target = isLandscape ? APPLE_65_LANDSCAPE : APPLE_65_PORTRAIT;
  return sharp(buffer)
    .resize(target.width, target.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    })
    .png()
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
}) {
  if (!packageName) throw new Error('Android Package Name이 설정되지 않았습니다.');

  const byLocale = normalizeLocaleMap({ metadata, metadataByLocale, defaultLocale });
  const locales = Object.keys(byLocale);
  if (locales.length === 0) throw new Error('업로드할 메타데이터가 없습니다.');

  const decodedScreenshots = decodeScreenshots(screenshots);
  const primaryCanonicalLocale = defaultLocale || locales[0];

  const serviceAccountJson = loadCredential(credentialId, encryptionKey);
  const client = gplay.createClient(serviceAccountJson);

  const editId = await gplay.createEdit(client, packageName);

  try {
    const perLocale = [];
    for (const canonicalLocale of locales) {
      const m = byLocale[canonicalLocale] || {};
      const language = toGooglePlayLocale(canonicalLocale);
      const { title, shortDescription, fullDescription, description } = m;

      await gplay.updateListing(client, packageName, editId, language, {
        title: title || undefined,
        shortDescription: shortDescription || undefined,
        fullDescription: (fullDescription || description) || undefined,
      });

      const entry = { locale: canonicalLocale, language, updated: Object.keys(m).filter(k => m[k]) };

      if (decodedScreenshots.length > 0 && canonicalLocale === primaryCanonicalLocale) {
        const uploaded = await gplay.replacePhoneScreenshots(
          client, packageName, editId, language, decodedScreenshots
        );
        entry.screenshotsUploaded = uploaded;
      }

      perLocale.push(entry);
    }

    await gplay.commitEdit(client, packageName, editId);

    const totalShots = perLocale.reduce((n, p) => n + (p.screenshotsUploaded || 0), 0);
    let message = `Google Play 스토어 메타데이터가 ${perLocale.length}개 로케일에 업데이트되었습니다.`;
    if (totalShots > 0) message += ` (스크린샷 ${totalShots}장 업로드됨)`;

    return { message, perLocale };
  } catch (err) {
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
}) {
  if (!bundleId) throw new Error('iOS Bundle ID가 설정되지 않았습니다.');

  const byLocale = normalizeLocaleMap({ metadata, metadataByLocale, defaultLocale });
  const locales = Object.keys(byLocale);
  if (locales.length === 0) throw new Error('업로드할 메타데이터가 없습니다.');

  const decodedScreenshots = decodeScreenshots(screenshots);
  const primaryCanonicalLocale = defaultLocale || locales[0];

  const credentialRaw = loadCredential(credentialId, encryptionKey);
  const credential = JSON.parse(credentialRaw);
  const { issuerId, keyId, privateKey } = credential;

  const jwt1 = apple.generateJWT(issuerId, keyId, privateKey);
  const app = await apple.getApp(jwt1, bundleId);

  const vStr = versionString || metadata?.versionString || '1.0.0';
  const jwt2 = apple.generateJWT(issuerId, keyId, privateKey);
  const version = await apple.getOrCreateVersion(jwt2, app.id, vStr);

  const perLocale = [];
  for (const canonicalLocale of locales) {
    const m = byLocale[canonicalLocale] || {};
    const appleLocale = toAppStoreLocale(canonicalLocale);

    try {
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

      if (decodedScreenshots.length > 0 && canonicalLocale === primaryCanonicalLocale && result?.localizationId) {
        try {
          const resized = [];
          for (const s of decodedScreenshots) {
            const buffer = await resizeToApple65(s.buffer);
            const base = (s.fileName || 'screenshot').replace(/\.[^.]+$/, '');
            resized.push({ buffer, fileName: `${base}_65.png` });
          }
          const jwtShots = apple.generateJWT(issuerId, keyId, privateKey);
          const { uploaded } = await apple.replaceScreenshots(
            jwtShots, result.localizationId, 'APP_IPHONE_65', resized
          );
          entry.screenshotsUploaded = uploaded;
        } catch (shotErr) {
          entry.screenshotError = shotErr.message;
        }
      }

      perLocale.push(entry);
    } catch (err) {
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
