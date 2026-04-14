import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = path.join(__dirname, '..', '.appdeploy_history');

// Ensure directory exists
fs.mkdirSync(HISTORY_DIR, { recursive: true });

function getFilePath(appId) {
  return path.join(HISTORY_DIR, `${appId}.json`);
}

/**
 * Load deployment history for an app.
 */
export function loadHistory(appId) {
  const filePath = getFilePath(appId);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Save a deployment record for an app.
 */
export function addHistoryEntry(appId, entry) {
  const history = loadHistory(appId);
  history.push({
    ...entry,
    savedAt: new Date().toISOString(),
  });
  fs.writeFileSync(getFilePath(appId), JSON.stringify(history, null, 2), 'utf-8');
  return history;
}

/**
 * Update a deployment entry's status.
 */
export function updateHistoryEntry(appId, deploymentId, updates) {
  const history = loadHistory(appId);
  const idx = history.findIndex(h => h.id === deploymentId);
  if (idx === -1) return history;
  history[idx] = { ...history[idx], ...updates, updatedAt: new Date().toISOString() };
  fs.writeFileSync(getFilePath(appId), JSON.stringify(history, null, 2), 'utf-8');
  return history;
}

/**
 * Get all history across all apps.
 */
export function getAllHistory() {
  const result = {};
  try {
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const appId = path.basename(file, '.json');
      result[appId] = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf-8'));
    }
  } catch {}
  return result;
}

/**
 * Delete history for an app.
 */
export function deleteHistory(appId) {
  const filePath = getFilePath(appId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
