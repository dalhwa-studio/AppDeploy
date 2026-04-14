import { loadCredential } from './credentialManager.js';
import * as gplay from './googlePlayApi.js';
import * as apple from './appStoreApi.js';

// Active polling sessions: Map<pollingId, { interval, config }>
const activePollers = new Map();

// Polling interval: 60 seconds
const POLL_INTERVAL = 60 * 1000;
// Max polling duration: 48 hours
const MAX_POLL_DURATION = 48 * 60 * 60 * 1000;

/**
 * Start polling for deployment status.
 * Emits 'deploy:status' events via Socket.IO when status changes.
 */
export function startPolling({ pollingId, store, config, encryptionKey }, io) {
  if (activePollers.has(pollingId)) return;

  const startTime = Date.now();
  let lastStatus = null;

  const poll = async () => {
    if (Date.now() - startTime > MAX_POLL_DURATION) {
      stopPolling(pollingId);
      return;
    }

    try {
      let currentStatus;

      if (store === 'google_play') {
        currentStatus = await pollGooglePlay(config, encryptionKey);
      } else if (store === 'app_store') {
        currentStatus = await pollAppStore(config, encryptionKey);
      }

      if (currentStatus && currentStatus.status !== lastStatus) {
        lastStatus = currentStatus.status;
        io.emit('deploy:status', {
          pollingId,
          store,
          ...currentStatus,
          updatedAt: new Date().toISOString(),
        });

        // Stop polling if we've reached a terminal state
        if (isTerminalState(store, currentStatus.status)) {
          stopPolling(pollingId);
        }
      }
    } catch (err) {
      console.error(`[StatusPoller] Error polling ${store}:`, err.message);
    }
  };

  // Initial poll
  poll();

  // Set interval
  const interval = setInterval(poll, POLL_INTERVAL);
  activePollers.set(pollingId, { interval, config, store, startTime });
}

/**
 * Stop a polling session.
 */
export function stopPolling(pollingId) {
  const poller = activePollers.get(pollingId);
  if (poller) {
    clearInterval(poller.interval);
    activePollers.delete(pollingId);
  }
}

/**
 * Get all active polling sessions.
 */
export function getActivePollers() {
  const result = [];
  for (const [id, { store, startTime }] of activePollers) {
    result.push({ id, store, startTime, duration: Date.now() - startTime });
  }
  return result;
}

/**
 * Stop all active polling sessions.
 */
export function stopAllPolling() {
  for (const [id] of activePollers) {
    stopPolling(id);
  }
}

// ─── Internal polling functions ───

async function pollGooglePlay({ credentialId, packageName, track }, encryptionKey) {
  const serviceAccountJson = loadCredential(credentialId, encryptionKey);
  const client = gplay.createClient(serviceAccountJson);
  const trackStatus = await gplay.getTrackStatus(client, packageName, track);

  if (!trackStatus) return null;

  // Map Google Play release status
  const statusMap = {
    completed: 'published',
    inProgress: 'in_review',
    draft: 'draft',
    halted: 'halted',
  };

  return {
    status: statusMap[trackStatus.status] || trackStatus.status,
    label: getGooglePlayStatusLabel(trackStatus.status),
    track: trackStatus.track,
    versionCodes: trackStatus.versionCodes,
    raw: trackStatus.status,
  };
}

async function pollAppStore({ credentialId, bundleId }, encryptionKey) {
  const credentialRaw = loadCredential(credentialId, encryptionKey);
  const credential = JSON.parse(credentialRaw);
  const { issuerId, keyId, privateKey } = credential;

  const jwt = apple.generateJWT(issuerId, keyId, privateKey);
  const app = await apple.getApp(jwt, bundleId);

  const jwt2 = apple.generateJWT(issuerId, keyId, privateKey);
  const versionStatus = await apple.getVersionStatus(jwt2, app.id);

  if (!versionStatus) return null;

  const mapped = apple.mapAppStoreState(versionStatus.state);

  return {
    status: mapped.status,
    label: mapped.label,
    versionString: versionStatus.versionString,
    raw: versionStatus.state,
  };
}

function getGooglePlayStatusLabel(status) {
  const labels = {
    completed: '출시됨',
    inProgress: '출시 진행 중',
    draft: '초안',
    halted: '중단됨',
  };
  return labels[status] || status;
}

function isTerminalState(store, status) {
  if (store === 'google_play') {
    return ['published', 'halted'].includes(status);
  }
  if (store === 'app_store') {
    return ['published', 'rejected', 'removed', 'failed'].includes(status);
  }
  return false;
}
