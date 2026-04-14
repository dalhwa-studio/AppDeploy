import { loadCredential } from './credentialManager.js';
import * as gplay from './googlePlayApi.js';
import * as apple from './appStoreApi.js';

/**
 * Sync metadata directly to Google Play via API.
 * Creates an edit, updates listing, and commits.
 */
export async function syncMetadataToGoogle({ credentialId, packageName, metadata, encryptionKey }) {
  if (!packageName) throw new Error('Android Package Name이 설정되지 않았습니다.');

  const serviceAccountJson = loadCredential(credentialId, encryptionKey);
  const client = gplay.createClient(serviceAccountJson);

  const editId = await gplay.createEdit(client, packageName);

  try {
    const { title, shortDescription, fullDescription } = metadata;

    await gplay.updateListing(client, packageName, editId, 'ko-KR', {
      title: title || undefined,
      shortDescription: shortDescription || undefined,
      fullDescription: fullDescription || undefined,
    });

    await gplay.commitEdit(client, packageName, editId);

    return {
      message: 'Google Play 스토어 메타데이터가 업데이트되었습니다.',
      updated: { title, shortDescription, fullDescription },
    };
  } catch (err) {
    // Rollback on failure
    await gplay.deleteEdit(client, packageName, editId);
    throw err;
  }
}

/**
 * Sync metadata directly to App Store Connect via API.
 * Finds the latest editable version and updates its localization.
 */
export async function syncMetadataToApple({ credentialId, bundleId, metadata, encryptionKey }) {
  if (!bundleId) throw new Error('iOS Bundle ID가 설정되지 않았습니다.');

  const credentialRaw = loadCredential(credentialId, encryptionKey);
  const credential = JSON.parse(credentialRaw);
  const { issuerId, keyId, privateKey } = credential;

  // Find app
  const jwt1 = apple.generateJWT(issuerId, keyId, privateKey);
  const app = await apple.getApp(jwt1, bundleId);

  // Find or create an editable version
  const jwt2 = apple.generateJWT(issuerId, keyId, privateKey);
  const version = await apple.getOrCreateVersion(jwt2, app.id, metadata.versionString || '1.0.0');

  // Update localization
  const jwt3 = apple.generateJWT(issuerId, keyId, privateKey);
  await apple.updateVersionLocalization(jwt3, version.id, 'ko', {
    description: metadata.description,
    keywords: metadata.keywords,
    whatsNew: metadata.whatsNew,
    promotionalText: metadata.promotionalText,
    marketingUrl: metadata.marketingUrl,
  });

  return {
    message: 'App Store 메타데이터가 업데이트되었습니다.',
    versionId: version.id,
    versionString: version.versionString,
  };
}
