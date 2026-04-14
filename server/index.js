import express from 'express';
import cors from 'cors';
import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3721;

// ─── Encryption key (must be 32 bytes hex in production) ───
const ENCRYPTION_KEY = process.env.ENCRYPTION_MASTER_KEY
  || crypto.randomBytes(32).toString('hex');

if (!process.env.ENCRYPTION_MASTER_KEY) {
  console.warn('⚠️  ENCRYPTION_MASTER_KEY 환경변수가 설정되지 않았습니다. 임시 키를 생성합니다.');
  console.warn('   프로덕션에서는 반드시 .env 파일에 설정해 주세요.');
}

// ─── Middleware ───
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// ─── Directories ───
const KEYS_DIR = path.join(__dirname, '.appdeploy_keys');
const SYNC_DIR = path.join(__dirname, '.appdeploy_sync');
const BUILDS_DIR = path.join(__dirname, '.appdeploy_builds');
fs.mkdirSync(KEYS_DIR, { recursive: true });
fs.mkdirSync(SYNC_DIR, { recursive: true });
fs.mkdirSync(BUILDS_DIR, { recursive: true });

// ═══════════════════════════════════════════
// Encryption utilities (AES-256-GCM)
// ═══════════════════════════════════════════
function encrypt(plainText) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return {
    encrypted: encrypted + ':' + authTag,
    iv: iv.toString('hex'),
  };
}

function decrypt(encryptedData, ivHex) {
  const [encrypted, authTag] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ═══════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════

// ─── Health Check ───
app.get('/api/health', (req, res) => {
  let fastlaneVersion = 'not installed';
  try {
    fastlaneVersion = execSync('fastlane --version 2>&1').toString().trim().split('\n').pop();
  } catch {}

  res.json({
    status: 'ok',
    fastlane: fastlaneVersion,
    encryption: ENCRYPTION_KEY ? 'active' : 'inactive',
    timestamp: new Date().toISOString(),
  });
});

// ─── Upload Store Credential ───
app.post('/api/store-accounts/upload', (req, res) => {
  const { storeType, fileName, fileContent, metadata } = req.body;

  if (!storeType || !fileContent) {
    return res.json({ success: false, error: '필수 정보가 누락되었습니다.' });
  }

  try {
    // Validate file content
    if (storeType === 'google_play') {
      const parsed = JSON.parse(fileContent);
      if (parsed.type !== 'service_account') {
        return res.json({ success: false, error: '유효한 Service Account JSON이 아닙니다.' });
      }
    } else if (storeType === 'app_store') {
      if (!fileContent.includes('BEGIN PRIVATE KEY')) {
        return res.json({ success: false, error: '.p8 파일에 PRIVATE KEY가 포함되어 있지 않습니다.' });
      }
    }

    // Encrypt and store
    const { encrypted, iv } = encrypt(fileContent);
    const credentialId = crypto.randomUUID();
    const credPath = path.join(KEYS_DIR, `${credentialId}.enc`);

    fs.writeFileSync(credPath, JSON.stringify({
      id: credentialId,
      storeType,
      fileName,
      encrypted,
      iv,
      metadata: metadata || {},
      createdAt: new Date().toISOString(),
    }));

    res.json({
      success: true,
      credentialId,
      message: `${storeType === 'google_play' ? 'Google Play' : 'App Store'} 자격증명이 안전하게 저장되었습니다.`,
    });
  } catch (err) {
    res.json({ success: false, error: `저장 실패: ${err.message}` });
  }
});

// ─── Metadata Sync (Generate Fastlane files) ───
app.post('/api/sync/metadata', (req, res) => {
  const { appData, store } = req.body;

  if (!appData) {
    return res.json({ success: false, error: '앱 데이터가 없습니다.' });
  }

  try {
    const bundleId = store === 'google_play'
      ? appData.androidPackageName
      : appData.iosBundleId;

    if (!bundleId) {
      return res.json({ success: false, error: `${store === 'google_play' ? 'Android Package Name' : 'iOS Bundle ID'}이 설정되지 않았습니다.` });
    }

    const workDir = path.join(SYNC_DIR, bundleId.replace(/\./g, '_'));
    fs.mkdirSync(workDir, { recursive: true });

    const shared = appData.shared || {};
    const locale = 'ko'; // Default locale

    if (store === 'app_store' || store === 'both') {
      // Apple metadata (Fastlane deliver format)
      const applePath = path.join(workDir, 'metadata', locale);
      fs.mkdirSync(applePath, { recursive: true });

      const appleStore = appData.appStore || {};
      const appleFiles = {
        'name.txt': (shared.appName || '').substring(0, 30),
        'subtitle.txt': (appleStore.subtitle || '').substring(0, 30),
        'description.txt': (shared.description || '').substring(0, 4000),
        'keywords.txt': (appleStore.keywords || '').substring(0, 100),
        'promotional_text.txt': (appleStore.promotionalText || '').substring(0, 170),
        'release_notes.txt': (appleStore.whatsNew || '').substring(0, 4000),
        'privacy_url.txt': shared.privacyUrl || '',
        'support_url.txt': shared.supportUrl || '',
        'marketing_url.txt': appleStore.marketingUrl || '',
      };

      for (const [filename, content] of Object.entries(appleFiles)) {
        fs.writeFileSync(path.join(applePath, filename), content, 'utf-8');
      }

      if (appleStore.copyright) {
        fs.writeFileSync(path.join(workDir, 'metadata', 'copyright.txt'), appleStore.copyright, 'utf-8');
      }
    }

    if (store === 'google_play' || store === 'both') {
      // Google metadata (Fastlane supply format)
      const googlePath = path.join(workDir, 'metadata', 'android', 'ko-KR');
      fs.mkdirSync(googlePath, { recursive: true });

      const googlePlay = appData.googlePlay || {};
      const googleFiles = {
        'title.txt': (shared.appName || '').substring(0, 30),
        'short_description.txt': (googlePlay.shortDescription || '').substring(0, 80),
        'full_description.txt': (shared.description || '').substring(0, 4000),
      };

      for (const [filename, content] of Object.entries(googleFiles)) {
        fs.writeFileSync(path.join(googlePath, filename), content, 'utf-8');
      }

      if (googlePlay.releaseNotes) {
        const changelogDir = path.join(googlePath, 'changelogs');
        fs.mkdirSync(changelogDir, { recursive: true });
        fs.writeFileSync(
          path.join(changelogDir, 'default.txt'),
          googlePlay.releaseNotes.substring(0, 500),
          'utf-8'
        );
      }
    }

    res.json({
      success: true,
      workDir,
      message: '메타데이터 파일이 생성되었습니다.',
    });
  } catch (err) {
    console.error('[Metadata Sync Error]', err);
    res.json({ success: false, error: err.message });
  }
});

// ─── Deploy to Google Play ───
app.post('/api/deploy/google', async (req, res) => {
  const { appData } = req.body;
  const shared = appData?.shared || {};
  const googlePlay = appData?.googlePlay || {};

  if (!appData?.androidPackageName) {
    return res.json({ success: false, error: 'Android Package Name이 설정되지 않았습니다.' });
  }

  const workDir = path.join(SYNC_DIR, appData.androidPackageName.replace(/\./g, '_'));

  try {
    // Generate metadata files first
    const metaResult = await fetch(`http://localhost:${PORT}/api/sync/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appData, store: 'google_play' }),
    });

    // TODO: Implement actual Google Play API deployment
    // For now, return simulated success
    res.json({
      success: true,
      message: `Google Play (${googlePlay.track || 'internal'} 트랙)에 배포가 시작되었습니다.`,
      deploymentId: crypto.randomUUID(),
      status: 'queued',
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Deploy to App Store ───
app.post('/api/deploy/apple', async (req, res) => {
  const { appData } = req.body;

  if (!appData?.iosBundleId) {
    return res.json({ success: false, error: 'iOS Bundle ID가 설정되지 않았습니다.' });
  }

  try {
    // Generate metadata files first
    await fetch(`http://localhost:${PORT}/api/sync/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appData, store: 'app_store' }),
    });

    // TODO: Implement actual App Store Connect API deployment
    res.json({
      success: true,
      message: 'App Store에 배포가 시작되었습니다.',
      deploymentId: crypto.randomUUID(),
      status: 'queued',
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Screenshots save ───
app.post('/api/screenshots/save', (req, res) => {
  const { bundleId, screenshots } = req.body;
  if (!bundleId || !Array.isArray(screenshots)) {
    return res.json({ success: false, error: '잘못된 데이터' });
  }

  try {
    const baseDir = path.join(SYNC_DIR, bundleId.replace(/\./g, '_'));

    screenshots.forEach((ss, idx) => {
      if (!ss.dataUrl) return;
      const base64Data = ss.dataUrl.replace(/^data:image\/\w+;base64,/, '');

      // Apple screenshots
      const appleDir = path.join(baseDir, 'screenshots', 'ko');
      fs.mkdirSync(appleDir, { recursive: true });
      fs.writeFileSync(path.join(appleDir, `${idx + 1}.png`), base64Data, 'base64');

      // Google screenshots
      const googleDir = path.join(baseDir, 'metadata', 'android', 'ko-KR', 'images', 'phoneScreenshots');
      fs.mkdirSync(googleDir, { recursive: true });
      fs.writeFileSync(path.join(googleDir, `${idx + 1}.png`), base64Data, 'base64');
    });

    res.json({ success: true, count: screenshots.length });
  } catch (err) {
    console.error('[Screenshot Save Error]', err);
    res.json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════╗
  ║  🚀 AppDeploy Backend Server              ║
  ║  http://localhost:${PORT}                    ║
  ║                                            ║
  ║  🔒 암호화: AES-256-GCM 활성              ║
  ║  📁 키 저장: ${KEYS_DIR}     ║
  ╚════════════════════════════════════════════╝
  `);
});
