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
import { deployToGooglePlay, deployToAppStore, getDeploymentStatus } from './lib/deploymentManager.js';
import { startPolling, stopPolling, getActivePollers } from './lib/statusPoller.js';
import { syncMetadataToGoogle, syncMetadataToApple } from './lib/metadataSync.js';
import { generateForLocales } from './lib/asoGenerator.js';
import { isFastlaneAvailable, getFastlaneVersion, runFastlaneLane, generateFastfile } from './lib/fastlaneRunner.js';
import { loadHistory, addHistoryEntry, updateHistoryEntry, getAllHistory } from './lib/historyStore.js';
import { getState as getAppState, replaceState as replaceAppState, upsertApp, deleteApp as deleteAppEntry, setStoreAccounts } from './lib/appStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3721;

// ─── Encryption key (must be 32 bytes hex in production) ───
// Priority: env var > persisted local key file > newly generated (and persisted)
const KEYS_DIR_FOR_MASTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '.appdeploy_keys');
const MASTER_KEY_FILE = path.join(KEYS_DIR_FOR_MASTER, '.master.key');

function resolveEncryptionKey() {
  if (process.env.ENCRYPTION_MASTER_KEY) return process.env.ENCRYPTION_MASTER_KEY;

  fs.mkdirSync(KEYS_DIR_FOR_MASTER, { recursive: true });

  if (fs.existsSync(MASTER_KEY_FILE)) {
    const key = fs.readFileSync(MASTER_KEY_FILE, 'utf-8').trim();
    if (key.length === 64) {
      console.warn('⚠️  ENCRYPTION_MASTER_KEY 환경변수가 없지만, 저장된 로컬 키를 사용합니다.');
      console.warn(`   경로: ${MASTER_KEY_FILE}`);
      console.warn('   프로덕션에서는 반드시 .env 파일에 ENCRYPTION_MASTER_KEY를 설정하세요.');
      return key;
    }
  }

  const newKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(MASTER_KEY_FILE, newKey, { mode: 0o600 });
  console.warn('⚠️  ENCRYPTION_MASTER_KEY가 없어 새 키를 생성하여 로컬에 저장했습니다.');
  console.warn(`   경로: ${MASTER_KEY_FILE}`);
  console.warn('   이 키로 암호화된 자격증명은 이 키가 있어야만 복호화됩니다.');
  console.warn('   프로덕션에서는 반드시 .env 파일에 ENCRYPTION_MASTER_KEY를 설정하세요.');
  return newKey;
}

const ENCRYPTION_KEY = resolveEncryptionKey();

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

// ─── Metadata Sync to Store (actual API upload) ───
app.post('/api/sync/metadata/store', async (req, res) => {
  const { store, credentialId, packageName, bundleId, metadata, metadataByLocale, defaultLocale, versionString } = req.body;

  if (!store || !credentialId) {
    return res.json({ success: false, error: '스토어 타입과 자격증명이 필요합니다.' });
  }

  try {
    const common = { credentialId, metadata, metadataByLocale, defaultLocale, versionString, encryptionKey: ENCRYPTION_KEY };
    let result;
    if (store === 'google_play') {
      result = await syncMetadataToGoogle({ ...common, packageName });
    } else if (store === 'app_store') {
      result = await syncMetadataToApple({ ...common, bundleId });
    } else {
      return res.json({ success: false, error: '지원하지 않는 스토어 타입입니다.' });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Metadata Store Sync Error]', err);
    res.json({ success: false, error: err.message });
  }
});

// ─── LLM Credential (Anthropic / OpenAI API Key) ───
app.post('/api/llm-credential', (req, res) => {
  const { provider, apiKey } = req.body;
  if (!provider || !apiKey) {
    return res.json({ success: false, error: 'provider와 apiKey가 필요합니다.' });
  }
  if (!['anthropic', 'openai'].includes(provider)) {
    return res.json({ success: false, error: '지원하지 않는 provider입니다.' });
  }
  try {
    // Remove any existing llm credential for this provider
    try {
      const existing = findCredentialByType(`llm_${provider}`);
      if (existing) {
        const fs2 = fs;
        const p = path.join(KEYS_DIR, `${existing.id}.enc`);
        if (fs2.existsSync(p)) fs2.unlinkSync(p);
      }
    } catch {}
    const credentialId = saveCredential(
      { storeType: `llm_${provider}`, fileName: `${provider}.key`, fileContent: apiKey, metadata: { provider } },
      ENCRYPTION_KEY
    );
    res.json({ success: true, credentialId, provider });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/llm-credential', (req, res) => {
  try {
    const anth = findCredentialByType('llm_anthropic');
    const oai = findCredentialByType('llm_openai');
    res.json({
      success: true,
      anthropic: anth ? { credentialId: anth.id, createdAt: anth.createdAt } : null,
      openai: oai ? { credentialId: oai.id, createdAt: oai.createdAt } : null,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.delete('/api/llm-credential/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    const existing = findCredentialByType(`llm_${provider}`);
    if (!existing) return res.json({ success: true });
    const p = path.join(KEYS_DIR, `${existing.id}.enc`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── ASO Generation (translate + optimize per locale) ───
app.post('/api/metadata/generate-aso', async (req, res) => {
  const { provider, store, sourceLocale, sourceMetadata, targetLocales } = req.body;

  if (!provider || !sourceMetadata || !Array.isArray(targetLocales) || targetLocales.length === 0) {
    return res.json({ success: false, error: 'provider / sourceMetadata / targetLocales가 필요합니다.' });
  }

  try {
    const cred = findCredentialByType(`llm_${provider}`);
    if (!cred) {
      return res.json({ success: false, error: `${provider} API Key가 설정되지 않았습니다. 설정 페이지에서 등록해 주세요.` });
    }
    const apiKey = loadCredential(cred.id, ENCRYPTION_KEY);

    const results = await generateForLocales({
      provider,
      apiKey,
      store: store || 'both',
      sourceLocale: sourceLocale || 'ko-KR',
      sourceMetadata,
      targetLocales,
    });

    res.json({ success: true, results });
  } catch (err) {
    console.error('[ASO Generate Error]', err);
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
  const { bundleId, credentialId, buildId, versionString, metadata, reviewInfo, socketId } = req.body;

  if (!bundleId) {
    return res.json({ success: false, error: 'iOS Bundle ID가 설정되지 않았습니다.' });
  }
  if (!credentialId) {
    return res.json({ success: false, error: '자격증명이 설정되지 않았습니다. App Store 탭에서 API Key를 업로드해 주세요.' });
  }
  if (!buildId) {
    return res.json({ success: false, error: 'IPA 파일이 업로드되지 않았습니다.' });
  }

  // Find the IPA file
  const buildFiles = fs.readdirSync(BUILDS_DIR);
  const ipaFile = buildFiles.find(f => f.startsWith(buildId));
  if (!ipaFile) {
    return res.json({ success: false, error: '빌드 파일을 찾을 수 없습니다. IPA를 다시 업로드해 주세요.' });
  }
  const ipaFilePath = path.join(BUILDS_DIR, ipaFile);

  // Return immediately, deploy async
  const deploymentId = crypto.randomUUID();
  res.json({
    success: true,
    deploymentId,
    status: 'in_progress',
    message: 'App Store 배포가 시작되었습니다.',
  });

  // Run deployment asynchronously
  deployToAppStore({
    bundleId,
    credentialId,
    ipaFilePath,
    versionString: versionString || '1.0.0',
    metadata,
    reviewInfo,
    encryptionKey: ENCRYPTION_KEY,
  }, io, socketId).catch(err => {
    console.error('[App Store Deploy Error]', err.message);
  });
});

// ─── Start Status Polling ───
app.post('/api/deploy/poll', (req, res) => {
  const { pollingId, store, credentialId, packageName, bundleId, track } = req.body;

  if (!store || !credentialId) {
    return res.json({ success: false, error: '스토어 타입과 자격증명이 필요합니다.' });
  }

  const config = store === 'google_play'
    ? { credentialId, packageName, track: track || 'internal' }
    : { credentialId, bundleId };

  const id = pollingId || crypto.randomUUID();

  startPolling({ pollingId: id, store, config, encryptionKey: ENCRYPTION_KEY }, io);

  res.json({ success: true, pollingId: id, message: '상태 폴링이 시작되었습니다.' });
});

// ─── Stop Status Polling ───
app.delete('/api/deploy/poll/:pollingId', (req, res) => {
  stopPolling(req.params.pollingId);
  res.json({ success: true, message: '폴링이 중지되었습니다.' });
});

// ─── Get Active Pollers ───
app.get('/api/deploy/poll', (req, res) => {
  res.json({ success: true, pollers: getActivePollers() });
});

// ─── Fastlane: Status ───
app.get('/api/fastlane/status', (req, res) => {
  const available = isFastlaneAvailable();
  res.json({
    success: true,
    available,
    version: available ? getFastlaneVersion() : null,
  });
});

// ─── Fastlane: Generate Fastfile ───
app.post('/api/fastlane/init', (req, res) => {
  const { bundleId, platform, scheme } = req.body;
  if (!bundleId) {
    return res.json({ success: false, error: 'Bundle ID가 필요합니다.' });
  }

  try {
    const workDir = path.join(SYNC_DIR, bundleId.replace(/\./g, '_'));
    fs.mkdirSync(workDir, { recursive: true });
    const fastfilePath = generateFastfile(workDir, { platform, bundleId, scheme });
    res.json({ success: true, fastfilePath, message: 'Fastfile이 생성되었습니다.' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Fastlane: Run Lane ───
app.post('/api/fastlane/run', async (req, res) => {
  const { lane, platform, bundleId, env, socketId } = req.body;

  if (!lane) {
    return res.json({ success: false, error: 'lane 이름이 필요합니다.' });
  }

  if (!isFastlaneAvailable()) {
    return res.json({ success: false, error: 'Fastlane이 설치되어 있지 않습니다.' });
  }

  const workDir = bundleId
    ? path.join(SYNC_DIR, bundleId.replace(/\./g, '_'))
    : SYNC_DIR;

  // Return immediately
  const runId = crypto.randomUUID();
  res.json({ success: true, runId, message: `Fastlane ${lane} 실행이 시작되었습니다.` });

  // Run async with Socket.IO output streaming
  try {
    await runFastlaneLane(
      { lane, platform, workDir, env },
      (data) => {
        if (io && socketId) {
          io.to(socketId).emit('fastlane:output', { runId, ...data });
        }
      }
    );
    if (io && socketId) {
      io.to(socketId).emit('fastlane:complete', { runId, success: true });
    }
  } catch (err) {
    if (io && socketId) {
      io.to(socketId).emit('fastlane:error', { runId, error: err.message });
    }
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

// ─── Apps: Get all (with storeAccounts) ───
app.get('/api/apps', (req, res) => {
  res.json({ success: true, ...getAppState() });
});

// ─── Apps: Replace whole state (used for one-time migration / bulk import) ───
app.put('/api/apps', (req, res) => {
  try {
    const next = replaceAppState(req.body);
    res.json({ success: true, ...next });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Apps: Upsert single app ───
app.put('/api/apps/:id', (req, res) => {
  try {
    const app = req.body;
    if (!app || app.id !== req.params.id) {
      return res.json({ success: false, error: 'app.id가 URL과 일치해야 합니다.' });
    }
    upsertApp(app);
    res.json({ success: true, app });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Apps: Delete ───
app.delete('/api/apps/:id', (req, res) => {
  try {
    deleteAppEntry(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Apps: Update storeAccounts ───
app.patch('/api/apps/store-accounts', (req, res) => {
  try {
    const accounts = setStoreAccounts(req.body || {});
    res.json({ success: true, storeAccounts: accounts });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── Deployment History: Get ───
app.get('/api/history/:appId', (req, res) => {
  const history = loadHistory(req.params.appId);
  res.json({ success: true, history });
});

// ─── Deployment History: Add ───
app.post('/api/history/:appId', (req, res) => {
  const { entry } = req.body;
  if (!entry) {
    return res.json({ success: false, error: '히스토리 항목이 필요합니다.' });
  }
  const history = addHistoryEntry(req.params.appId, entry);
  res.json({ success: true, history });
});

// ─── Deployment History: Update ───
app.patch('/api/history/:appId/:deploymentId', (req, res) => {
  const { updates } = req.body;
  const history = updateHistoryEntry(req.params.appId, req.params.deploymentId, updates);
  res.json({ success: true, history });
});

// ─── Deployment History: Get All ───
app.get('/api/history', (req, res) => {
  const allHistory = getAllHistory();
  res.json({ success: true, history: allHistory });
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
