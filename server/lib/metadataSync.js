import { loadCredential } from './credentialManager.js';
import * as gplay from './googlePlayApi.js';
import * as apple from './appStoreApi.js';
import { toAppStoreLocale, toGooglePlayLocale, DEFAULT_LOCALE } from './localeMapper.js';

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
}) {
  if (!packageName) throw new Error('Android Package Name이 설정되지 않았습니다.');

  const byLocale = normalizeLocaleMap({ metadata, metadataByLocale, defaultLocale });
  const locales = Object.keys(byLocale);
  if (locales.length === 0) throw new Error('업로드할 메타데이터가 없습니다.');

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

      perLocale.push({ locale: canonicalLocale, language, updated: Object.keys(m).filter(k => m[k]) });
    }

    await gplay.commitEdit(client, packageName, editId);

    return {
      message: `Google Play 스토어 메타데이터가 ${perLocale.length}개 로케일에 업데이트되었습니다.`,
      perLocale,
    };
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
}) {
  if (!bundleId) throw new Error('iOS Bundle ID가 설정되지 않았습니다.');

  const byLocale = normalizeLocaleMap({ metadata, metadataByLocale, defaultLocale });
  const locales = Object.keys(byLocale);
  if (locales.length === 0) throw new Error('업로드할 메타데이터가 없습니다.');

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
      perLocale.push({
        locale: canonicalLocale,
        appleLocale,
        updated: result?.updated || [],
        skipped: result?.skipped || [],
      });
    } catch (err) {
      perLocale.push({ locale: canonicalLocale, appleLocale, error: err.message });
    }
  }

  const totalUpdated = perLocale.reduce((n, p) => n + (p.updated?.length || 0), 0);
  const hasSkipped = perLocale.some(p => p.skipped?.length);
  const hasError = perLocale.some(p => p.error);

  let message = `App Store 메타데이터가 ${perLocale.length}개 로케일에 업데이트되었습니다.`;
  if (hasError) message += ' (일부 로케일 실패)';
  else if (hasSkipped) message += ` (현재 버전 상태(${version.state})에서는 일부 필드가 편집 불가능하여 건너뜀)`;

  return {
    message,
    versionId: version.id,
    versionString: version.versionString,
    versionState: version.state,
    totalUpdated,
    perLocale,
  };
}
