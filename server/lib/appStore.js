import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '.appdeploy_data');
const APPS_FILE = path.join(DATA_DIR, 'apps.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

function readAll() {
  if (!fs.existsSync(APPS_FILE)) {
    return { apps: [], storeAccounts: { googlePlay: null, appStore: null } };
  }
  try {
    const data = JSON.parse(fs.readFileSync(APPS_FILE, 'utf-8'));
    return {
      apps: Array.isArray(data.apps) ? data.apps : [],
      storeAccounts: data.storeAccounts || { googlePlay: null, appStore: null },
    };
  } catch {
    return { apps: [], storeAccounts: { googlePlay: null, appStore: null } };
  }
}

function writeAll(data) {
  fs.writeFileSync(APPS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getState() {
  return readAll();
}

export function replaceState(next) {
  const safe = {
    apps: Array.isArray(next?.apps) ? next.apps : [],
    storeAccounts: next?.storeAccounts || { googlePlay: null, appStore: null },
  };
  writeAll(safe);
  return safe;
}

export function upsertApp(app) {
  const state = readAll();
  const idx = state.apps.findIndex(a => a.id === app.id);
  if (idx === -1) state.apps.push(app);
  else state.apps[idx] = app;
  writeAll(state);
  return app;
}

export function deleteApp(id) {
  const state = readAll();
  state.apps = state.apps.filter(a => a.id !== id);
  writeAll(state);
}

export function setStoreAccounts(partial) {
  const state = readAll();
  state.storeAccounts = { ...state.storeAccounts, ...partial };
  writeAll(state);
  return state.storeAccounts;
}
