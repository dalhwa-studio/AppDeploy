import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { loadCredential } from './credentialManager.js';
import * as gplay from './googlePlayApi.js';
import * as apple from './appStoreApi.js';

// In-memory deployment state
const deployments = new Map();

export function getDeploymentStatus(deploymentId) {
  return deployments.get(deploymentId) || null;
}

function emitProgress(io, socketId, deploymentId, step, progress, message) {
  const state = { deploymentId, step, progress, message, updatedAt: new Date().toISOString() };
  deployments.set(deploymentId, state);
  if (io && socketId) {
    io.to(socketId).emit('deploy:progress', state);
  }
}

export async function deployToGooglePlay({
  packageName, credentialId, aabFilePath, track, releaseNotes, metadata, encryptionKey,
}, io, socketId) {
  const deploymentId = crypto.randomUUID();
  let client = null;
  let editId = null;

  try {
    // Step 1: Decrypt credential
    emitProgress(io, socketId, deploymentId, 'DECRYPT_CREDENTIAL', 5, '자격증명 복호화 중...');
    const serviceAccountJson = loadCredential(credentialId, encryptionKey);

    // Step 2: Auth
    emitProgress(io, socketId, deploymentId, 'AUTH', 10, 'Google Play API 인증 중...');
    client = gplay.createClient(serviceAccountJson);

    // Step 3: Create edit
    emitProgress(io, socketId, deploymentId, 'CREATE_EDIT', 15, '편집 세션 생성 중...');
    editId = await gplay.createEdit(client, packageName);

    // Step 4: Upload bundle
    emitProgress(io, socketId, deploymentId, 'UPLOAD_BUNDLE', 20, 'AAB 파일 업로드 중...');
    const versionCode = await gplay.uploadBundle(client, packageName, editId, aabFilePath);
    emitProgress(io, socketId, deploymentId, 'UPLOAD_BUNDLE', 70, `AAB 업로드 완료 (versionCode: ${versionCode})`);

    // Step 5: Update track
    emitProgress(io, socketId, deploymentId, 'UPDATE_TRACK', 75, `${track} 트랙 설정 중...`);
    await gplay.updateTrack(client, packageName, editId, track, versionCode, releaseNotes);

    // Step 6: Update listing (optional)
    if (metadata?.title || metadata?.shortDescription || metadata?.fullDescription) {
      emitProgress(io, socketId, deploymentId, 'UPDATE_LISTING', 85, '메타데이터 업데이트 중...');
      await gplay.updateListing(client, packageName, editId, 'ko-KR', metadata);
    } else {
      emitProgress(io, socketId, deploymentId, 'UPDATE_LISTING', 85, '메타데이터 업데이트 건너뜀');
    }

    // Step 7: Commit
    emitProgress(io, socketId, deploymentId, 'COMMIT', 95, '변경사항 적용 중...');
    await gplay.commitEdit(client, packageName, editId);

    // Done
    emitProgress(io, socketId, deploymentId, 'DONE', 100, '배포 완료!');

    const finalState = {
      deploymentId,
      step: 'DONE',
      progress: 100,
      status: 'completed',
      versionCode,
      message: `Google Play (${track} 트랙)에 성공적으로 배포되었습니다.`,
      pollingConfig: {
        store: 'google_play',
        credentialId,
        packageName,
        track,
      },
    };
    deployments.set(deploymentId, finalState);
    if (io && socketId) {
      io.to(socketId).emit('deploy:complete', finalState);
    }
    return finalState;

  } catch (err) {
    // Rollback: delete edit if it was created
    if (client && editId) {
      await gplay.deleteEdit(client, packageName, editId);
    }

    const errorMessage = parseGoogleApiError(err);
    const errorState = {
      deploymentId,
      step: deployments.get(deploymentId)?.step || 'UNKNOWN',
      progress: 0,
      status: 'failed',
      error: errorMessage,
    };
    deployments.set(deploymentId, errorState);
    if (io && socketId) {
      io.to(socketId).emit('deploy:error', errorState);
    }
    throw err;
  }
}

function parseGoogleApiError(err) {
  const status = err?.response?.status || err?.code;
  const message = err?.response?.data?.error?.message || err.message;

  if (status === 403) return `권한 오류: 서비스 계정 권한을 확인해 주세요. (${message})`;
  if (status === 404) return `앱을 찾을 수 없습니다. Google Play Console에서 앱이 등록되어 있는지 확인해 주세요.`;
  if (status === 400) return `요청 오류: ${message}`;
  if (status === 409) return `편집 충돌: 다른 편집이 진행 중입니다. 잠시 후 다시 시도해 주세요.`;
  return `배포 실패: ${message}`;
}

// ═══════════════════════════════════════════
// App Store (Apple) Deployment
// ═══════════════════════════════════════════

export async function deployToAppStore({
  bundleId, credentialId, ipaFilePath, versionString,
  metadata, reviewInfo, encryptionKey,
}, io, socketId) {
  const deploymentId = crypto.randomUUID();

  try {
    // Step 1: Decrypt credential
    emitProgress(io, socketId, deploymentId, 'APPLE_DECRYPT', 5, '자격증명 복호화 중...');
    const credentialRaw = loadCredential(credentialId, encryptionKey);
    const credential = JSON.parse(credentialRaw);
    const { issuerId, keyId, privateKey } = credential;

    // Step 2: Generate JWT & authenticate
    emitProgress(io, socketId, deploymentId, 'APPLE_AUTH', 10, 'App Store Connect API 인증 중...');
    const jwt = apple.generateJWT(issuerId, keyId, privateKey);

    // Step 3: Find app
    emitProgress(io, socketId, deploymentId, 'APPLE_FIND_APP', 15, `앱 조회 중 (${bundleId})...`);
    const app = await apple.getApp(jwt, bundleId);

    // Step 4: Upload IPA via altool
    emitProgress(io, socketId, deploymentId, 'APPLE_UPLOAD_IPA', 20, 'IPA 파일 업로드 중...');

    // Save private key to a temp file for altool
    const tempKeyDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.appdeploy_temp');
    fs.mkdirSync(tempKeyDir, { recursive: true });
    const tempKeyPath = path.join(tempKeyDir, `AuthKey_${keyId}.p8`);
    fs.writeFileSync(tempKeyPath, privateKey, 'utf-8');

    try {
      await apple.uploadIPA(ipaFilePath, { issuerId, keyId, privateKeyPath: tempKeyPath }, (msg) => {
        emitProgress(io, socketId, deploymentId, 'APPLE_UPLOAD_IPA', 35, msg);
      });
    } finally {
      // Clean up temp key
      try { fs.unlinkSync(tempKeyPath); } catch {}
    }

    emitProgress(io, socketId, deploymentId, 'APPLE_UPLOAD_IPA', 45, 'IPA 업로드 완료');

    // Step 5: Wait for build processing
    emitProgress(io, socketId, deploymentId, 'APPLE_PROCESS_BUILD', 50, 'Apple 빌드 처리 대기 중... (최대 10분)');
    // Regenerate JWT in case the wait is long
    const jwt2 = apple.generateJWT(issuerId, keyId, privateKey);
    const buildVersion = versionString.replace(/[^0-9.]/g, '');
    const build = await apple.waitForBuild(jwt2, app.id, buildVersion);
    emitProgress(io, socketId, deploymentId, 'APPLE_PROCESS_BUILD', 60, `빌드 처리 완료 (빌드: ${build.version})`);

    // Step 6: Create or get version
    emitProgress(io, socketId, deploymentId, 'APPLE_CREATE_VERSION', 65, `버전 ${versionString} 생성 중...`);
    const jwt3 = apple.generateJWT(issuerId, keyId, privateKey);
    const version = await apple.getOrCreateVersion(jwt3, app.id, versionString);

    // Step 7: Update version localization
    if (metadata) {
      emitProgress(io, socketId, deploymentId, 'APPLE_UPDATE_META', 72, '메타데이터 업데이트 중...');
      const jwt4 = apple.generateJWT(issuerId, keyId, privateKey);
      await apple.updateVersionLocalization(jwt4, version.id, 'ko', metadata);
    } else {
      emitProgress(io, socketId, deploymentId, 'APPLE_UPDATE_META', 72, '메타데이터 업데이트 건너뜀');
    }

    // Step 8: Update review detail
    if (reviewInfo && (reviewInfo.contactEmail || reviewInfo.notes)) {
      emitProgress(io, socketId, deploymentId, 'APPLE_REVIEW_INFO', 78, '심사 정보 설정 중...');
      const jwt5 = apple.generateJWT(issuerId, keyId, privateKey);
      await apple.updateReviewDetail(jwt5, version.id, reviewInfo);
    }

    // Step 9: Select build
    emitProgress(io, socketId, deploymentId, 'APPLE_SELECT_BUILD', 85, '빌드를 버전에 연결 중...');
    const jwt6 = apple.generateJWT(issuerId, keyId, privateKey);
    await apple.selectBuild(jwt6, version.id, build.id);

    // Step 10: Submit for review
    emitProgress(io, socketId, deploymentId, 'APPLE_SUBMIT', 92, '심사 제출 중...');
    const jwt7 = apple.generateJWT(issuerId, keyId, privateKey);
    await apple.submitForReview(jwt7, version.id);

    // Done
    emitProgress(io, socketId, deploymentId, 'DONE', 100, '심사 제출 완료!');

    const finalState = {
      deploymentId,
      step: 'DONE',
      progress: 100,
      status: 'completed',
      versionString,
      message: `App Store에 v${versionString} 심사가 제출되었습니다.`,
      pollingConfig: {
        store: 'app_store',
        credentialId,
        bundleId,
      },
    };
    deployments.set(deploymentId, finalState);
    if (io && socketId) {
      io.to(socketId).emit('deploy:complete', finalState);
    }
    return finalState;

  } catch (err) {
    const errorMessage = apple.parseAppleApiError(err);
    const errorState = {
      deploymentId,
      step: deployments.get(deploymentId)?.step || 'UNKNOWN',
      progress: 0,
      status: 'failed',
      error: errorMessage,
    };
    deployments.set(deploymentId, errorState);
    if (io && socketId) {
      io.to(socketId).emit('deploy:error', errorState);
    }
    throw err;
  }
}
