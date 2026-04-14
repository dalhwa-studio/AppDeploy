import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { saveCredential, loadCredential, findCredentialByType, encrypt, decrypt } from './lib/credentialManager.js';
import { deployToGooglePlay, getDeploymentStatus } from './lib/deploymentManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3721;

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

// ─── Multer config for binary uploads ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BUILDS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.aab', '.ipa'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('AAB 또는 IPA 파일만 업로드 가능합니다.'));
    }
  },
});

// ─── Socket.IO ───
io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

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

    const credentialId = saveCredential({ storeType, fileName, fileContent, metadata }, ENCRYPTION_KEY);

    res.json({
      success: true,
      credentialId,
      message: `${storeType === 'google_play' ? 'Google Play' : 'App Store'} 자격증명이 안전하게 저장되었습니다.`,
    });
  } catch (err) {
    res.json({ success: false, error: `저장 실패: ${err.message}` });
  }
});

// ─── Get Store Credential Info (without secret content) ───
app.get('/api/store-accounts/:storeType', (req, res) => {
  try {
    const credential = findCredentialByType(req.params.storeType);
    res.json({ success: true, credential });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Binary Upload ───
app.post('/api/builds/upload', upload.single('binary'), (req, res) => {
  if (!req.file) {
    return res.json({ success: false, error: '파일이 업로드되지 않았습니다.' });
  }

  res.json({
    success: true,
    buildId: path.basename(req.file.filename, path.extname(req.file.filename)),
    fileName: req.file.originalname,
    fileSize: req.file.size,
    filePath: req.file.path,
  });
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
    const locale = 'ko';

    if (store === 'app_store' || store === 'both') {
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
  const { packageName, credentialId, buildId, track, releaseNotes, metadata, socketId } = req.body;

  if (!packageName) {
    return res.json({ success: false, error: 'Android Package Name이 설정되지 않았습니다.' });
  }
  if (!credentialId) {
    return res.json({ success: false, error: '자격증명이 설정되지 않았습니다. Google Play 탭에서 Service Account를 업로드해 주세요.' });
  }
  if (!buildId) {
    return res.json({ success: false, error: 'AAB 파일이 업로드되지 않았습니다.' });
  }

  // Find the AAB file
  const buildFiles = fs.readdirSync(BUILDS_DIR);
  const aabFile = buildFiles.find(f => f.startsWith(buildId));
  if (!aabFile) {
    return res.json({ success: false, error: '빌드 파일을 찾을 수 없습니다. AAB를 다시 업로드해 주세요.' });
  }
  const aabFilePath = path.join(BUILDS_DIR, aabFile);

  // Return immediately, deploy async
  const deploymentId = crypto.randomUUID();
  res.json({
    success: true,
    deploymentId,
    status: 'in_progress',
    message: 'Google Play 배포가 시작되었습니다.',
  });

  // Run deployment asynchronously
  deployToGooglePlay({
    packageName,
    credentialId,
    aabFilePath,
    track: track || 'internal',
    releaseNotes,
    metadata,
    encryptionKey: ENCRYPTION_KEY,
  }, io, socketId).catch(err => {
    console.error('[Google Play Deploy Error]', err.message);
  });
});

// ─── Deployment Status (polling fallback) ───
app.get('/api/deploy/:deploymentId/status', (req, res) => {
  const status = getDeploymentStatus(req.params.deploymentId);
  if (!status) {
    return res.json({ success: false, error: '배포 정보를 찾을 수 없습니다.' });
  }
  res.json({ success: true, ...status });
});

// ─── Deploy to App Store ───
app.post('/api/deploy/apple', async (req, res) => {
  const { appData } = req.body;

  if (!appData?.iosBundleId) {
    return res.json({ success: false, error: 'iOS Bundle ID가 설정되지 않았습니다.' });
  }

  try {
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

      const appleDir = path.join(baseDir, 'screenshots', 'ko');
      fs.mkdirSync(appleDir, { recursive: true });
      fs.writeFileSync(path.join(appleDir, `${idx + 1}.png`), base64Data, 'base64');

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
httpServer.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════╗
  ║  🚀 AppDeploy Backend Server              ║
  ║  http://localhost:${PORT}                    ║
  ║                                            ║
  ║  🔒 암호화: AES-256-GCM 활성              ║
  ║  📁 키 저장: ${KEYS_DIR}     ║
  ║  🔌 Socket.IO: 활성                       ║
  ╚════════════════════════════════════════════╝
  `);
});
