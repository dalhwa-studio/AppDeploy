import crypto from 'crypto';
import fs from 'fs';
import { execSync, spawn } from 'child_process';

const API_BASE = 'https://api.appstoreconnect.apple.com';

/**
 * Generate a JWT for App Store Connect API (ES256).
 * Token is valid for 20 minutes (Apple maximum).
 */
export function generateJWT(issuerId, keyId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: issuerId,
    iat: now,
    exp: now + 1200, // 20 minutes
    aud: 'appstoreconnect-v1',
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKey);

  // Convert DER signature to raw r||s format for ES256
  const rawSig = derToRaw(signature);
  const encodedSignature = base64url(rawSig);

  return `${signingInput}.${encodedSignature}`;
}

function base64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function derToRaw(derSig) {
  // Parse DER encoded ECDSA signature to raw r||s (each 32 bytes for P-256)
  let offset = 2; // skip 0x30 + length
  if (derSig[offset] === 0x00) offset++; // skip extra length byte if present

  // Read r
  const rTag = derSig[offset++]; // 0x02
  let rLen = derSig[offset++];
  let rStart = offset;
  offset += rLen;

  // Read s
  const sTag = derSig[offset++]; // 0x02
  let sLen = derSig[offset++];
  let sStart = offset;

  // Extract r and s, removing leading zeros and padding to 32 bytes
  let r = derSig.subarray(rStart, rStart + rLen);
  let s = derSig.subarray(sStart, sStart + sLen);

  // Remove leading zero padding
  if (r.length === 33 && r[0] === 0) r = r.subarray(1);
  if (s.length === 33 && s[0] === 0) s = s.subarray(1);

  // Pad to 32 bytes
  const raw = Buffer.alloc(64);
  r.copy(raw, 32 - r.length);
  s.copy(raw, 64 - s.length);
  return raw;
}

/**
 * Make an authenticated request to the App Store Connect API.
 */
async function apiRequest(jwt, method, path, body) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
  };

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const text = await res.text();

  if (!res.ok) {
    const errorData = tryParseJson(text);
    const detail = errorData?.errors?.[0]?.detail || errorData?.errors?.[0]?.title || text;
    const err = new Error(detail);
    err.status = res.status;
    err.apiErrors = errorData?.errors;
    throw err;
  }

  return text ? tryParseJson(text) : null;
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Find an app by its Bundle ID.
 */
export async function getApp(jwt, bundleId) {
  const data = await apiRequest(jwt, 'GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
  const app = data?.data?.[0];
  if (!app) {
    throw new Error(`번들 ID "${bundleId}"에 해당하는 앱을 찾을 수 없습니다. App Store Connect에서 앱이 등록되어 있는지 확인해 주세요.`);
  }
  return { id: app.id, name: app.attributes.name, bundleId: app.attributes.bundleId };
}

/**
 * Get the latest processed build for an app.
 * Optionally filter by version string.
 */
export async function getBuilds(jwt, appId, version) {
  let path = `/v1/builds?filter[app]=${appId}&sort=-uploadedDate&limit=5&filter[processingState]=VALID`;
  if (version) {
    path += `&filter[version]=${encodeURIComponent(version)}`;
  }
  const data = await apiRequest(jwt, 'GET', path);
  return (data?.data || []).map(b => ({
    id: b.id,
    version: b.attributes.version,
    processingState: b.attributes.processingState,
    uploadedDate: b.attributes.uploadedDate,
    expired: b.attributes.expired,
  }));
}

/**
 * Wait for a build to appear and become VALID after IPA upload.
 */
export async function waitForBuild(jwt, appId, buildVersion, maxWaitMs = 600000) {
  const startTime = Date.now();
  const pollInterval = 15000; // 15 seconds

  while (Date.now() - startTime < maxWaitMs) {
    const allBuilds = await apiRequest(jwt, 'GET',
      `/v1/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(buildVersion)}&sort=-uploadedDate&limit=1`
    );

    const build = allBuilds?.data?.[0];
    if (build) {
      const state = build.attributes.processingState;
      if (state === 'VALID') {
        return {
          id: build.id,
          version: build.attributes.version,
          processingState: state,
        };
      }
      if (state === 'FAILED' || state === 'INVALID') {
        throw new Error(`빌드 처리 실패 (상태: ${state}). App Store Connect에서 빌드 상태를 확인해 주세요.`);
      }
      // PROCESSING — keep waiting
    }
    await sleep(pollInterval);
  }

  throw new Error('빌드 처리 시간 초과 (10분). App Store Connect에서 빌드 상태를 확인해 주세요.');
}

/**
 * Get existing App Store version or create a new one.
 */
export async function getOrCreateVersion(jwt, appId, versionString, platform = 'IOS') {
  // Check for existing editable version
  const existing = await apiRequest(jwt, 'GET',
    `/v1/apps/${appId}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED,WAITING_FOR_REVIEW,IN_REVIEW&filter[platform]=${platform}&limit=1`
  );

  if (existing?.data?.length > 0) {
    const ver = existing.data[0];
    return { id: ver.id, versionString: ver.attributes.versionString, state: ver.attributes.appStoreState };
  }

  // Create new version
  const body = {
    data: {
      type: 'appStoreVersions',
      attributes: {
        versionString,
        platform,
      },
      relationships: {
        app: { data: { type: 'apps', id: appId } },
      },
    },
  };

  const created = await apiRequest(jwt, 'POST', '/v1/appStoreVersions', body);
  const ver = created.data;
  return { id: ver.id, versionString: ver.attributes.versionString, state: ver.attributes.appStoreState };
}

/**
 * Update version localization (what's new, description, keywords, etc.)
 */
export async function updateVersionLocalization(jwt, versionId, locale, fields) {
  // Get existing localizations
  const locData = await apiRequest(jwt, 'GET',
    `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`
  );

  let localization = locData?.data?.find(l => l.attributes.locale === locale);

  const attributes = {};
  if (fields.whatsNew) attributes.whatsNew = fields.whatsNew;
  if (fields.description) attributes.description = fields.description;
  if (fields.keywords) attributes.keywords = fields.keywords;
  if (fields.promotionalText) attributes.promotionalText = fields.promotionalText;
  if (fields.marketingUrl) attributes.marketingUrl = fields.marketingUrl;

  if (Object.keys(attributes).length === 0) return;

  if (localization) {
    // Update existing
    await apiRequest(jwt, 'PATCH', `/v1/appStoreVersionLocalizations/${localization.id}`, {
      data: {
        type: 'appStoreVersionLocalizations',
        id: localization.id,
        attributes,
      },
    });
  } else {
    // Create new localization
    await apiRequest(jwt, 'POST', '/v1/appStoreVersionLocalizations', {
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: { locale, ...attributes },
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    });
  }
}

/**
 * Update App Review detail (contact info, demo account, review notes).
 */
export async function updateReviewDetail(jwt, versionId, reviewInfo) {
  // Get existing review detail
  const existing = await apiRequest(jwt, 'GET',
    `/v1/appStoreVersions/${versionId}/appStoreReviewDetail`
  );

  const attributes = {};
  if (reviewInfo.contactFirstName) attributes.contactFirstName = reviewInfo.contactFirstName;
  if (reviewInfo.contactLastName) attributes.contactLastName = reviewInfo.contactLastName;
  if (reviewInfo.contactPhone) attributes.contactPhone = reviewInfo.contactPhone;
  if (reviewInfo.contactEmail) attributes.contactEmail = reviewInfo.contactEmail;
  if (reviewInfo.notes) attributes.notes = reviewInfo.notes;
  if (reviewInfo.demoUsername) attributes.demoAccountName = reviewInfo.demoUsername;
  if (reviewInfo.demoPassword) attributes.demoAccountPassword = reviewInfo.demoPassword;
  attributes.demoAccountRequired = !!(reviewInfo.demoUsername && reviewInfo.demoPassword);

  if (existing?.data) {
    await apiRequest(jwt, 'PATCH', `/v1/appStoreReviewDetails/${existing.data.id}`, {
      data: {
        type: 'appStoreReviewDetails',
        id: existing.data.id,
        attributes,
      },
    });
  } else {
    await apiRequest(jwt, 'POST', '/v1/appStoreReviewDetails', {
      data: {
        type: 'appStoreReviewDetails',
        attributes,
        relationships: {
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    });
  }
}

/**
 * Attach a build to an App Store version.
 */
export async function selectBuild(jwt, versionId, buildId) {
  await apiRequest(jwt, 'PATCH', `/v1/appStoreVersions/${versionId}/relationships/build`, {
    data: { type: 'builds', id: buildId },
  });
}

/**
 * Submit the version for App Review.
 */
export async function submitForReview(jwt, versionId) {
  await apiRequest(jwt, 'POST', '/v1/appStoreVersionSubmissions', {
    data: {
      type: 'appStoreVersionSubmissions',
      relationships: {
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    },
  });
}

/**
 * Upload an IPA file via `xcrun altool`.
 * Requires Xcode Command Line Tools on macOS.
 * Uses API Key auth (--apiKey / --apiIssuer) — no Apple ID needed.
 */
export function uploadIPA(ipaPath, { issuerId, keyId, privateKeyPath }, onProgress) {
  return new Promise((resolve, reject) => {
    // Verify IPA exists
    if (!fs.existsSync(ipaPath)) {
      return reject(new Error(`IPA 파일을 찾을 수 없습니다: ${ipaPath}`));
    }

    // Check xcrun availability
    try {
      execSync('xcrun --version', { stdio: 'pipe' });
    } catch {
      return reject(new Error(
        'xcrun을 찾을 수 없습니다. Xcode Command Line Tools가 설치되어 있는지 확인해 주세요.\n' +
        '설치: xcode-select --install'
      ));
    }

    // Ensure the API key is in the expected location for altool
    const apiKeyDir = setupApiKeyForAltool(keyId, privateKeyPath);

    const args = [
      'altool', '--upload-app',
      '--type', 'ios',
      '--file', ipaPath,
      '--apiKey', keyId,
      '--apiIssuer', issuerId,
    ];

    onProgress?.('IPA 업로드 시작 (xcrun altool)...');

    const proc = spawn('xcrun', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(apiKeyDir ? { API_PRIVATE_KEYS_DIR: apiKeyDir } : {}),
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      const text = data.toString().trim();
      if (text) onProgress?.(text);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        const errorMsg = stderr || stdout || `altool 종료 코드: ${code}`;
        reject(new Error(`IPA 업로드 실패: ${errorMsg}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`altool 실행 실패: ${err.message}`));
    });
  });
}

/**
 * Setup the API key file in the location altool expects.
 * altool looks for AuthKey_{keyId}.p8 in:
 *   - ./private_keys/
 *   - ~/private_keys/
 *   - ~/.private_keys/
 *   - ~/.appstoreconnect/private_keys/
 */
function setupApiKeyForAltool(keyId, privateKeyPath) {
  const targetDir = new URL('../../.appdeploy_apikeys', import.meta.url).pathname;
  fs.mkdirSync(targetDir, { recursive: true });

  const targetFile = `${targetDir}/AuthKey_${keyId}.p8`;
  if (!fs.existsSync(targetFile)) {
    fs.copyFileSync(privateKeyPath, targetFile);
  }
  return targetDir;
}

/**
 * Parse Apple API errors into user-friendly messages.
 */
export function parseAppleApiError(err) {
  const status = err.status;
  const message = err.message;

  if (status === 401) return `인증 오류: API Key 정보를 확인해 주세요. Issuer ID, Key ID, .p8 키가 올바른지 확인하세요.`;
  if (status === 403) return `권한 오류: API Key에 App Manager 이상의 권한이 필요합니다. (${message})`;
  if (status === 404) return `리소스를 찾을 수 없습니다: ${message}`;
  if (status === 409) return `충돌: ${message}`;
  if (status === 422) return `유효성 검사 실패: ${message}`;
  return `App Store Connect API 오류: ${message}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
