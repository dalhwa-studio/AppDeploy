import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_APP, APP_STATUSES, API_BASE } from '../utils/constants';

const AppContext = createContext(null);

/* ─── Server Persistence ─── */
const LEGACY_STORAGE_KEY = 'appdeploy_data';
const MIGRATION_FLAG_KEY = 'appdeploy_migrated_to_server';

async function fetchState() {
  const res = await fetch(`${API_BASE}/apps`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'failed to load apps');
  return {
    apps: data.apps || [],
    storeAccounts: data.storeAccounts || { googlePlay: null, appStore: null },
  };
}

async function pushState(state) {
  await fetch(`${API_BASE}/apps`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apps: state.apps,
      storeAccounts: state.storeAccounts,
    }),
  });
}

function readLegacyLocal() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.apps)) return null;
    return {
      apps: data.apps,
      storeAccounts: data.storeAccounts || { googlePlay: null, appStore: null },
    };
  } catch {
    return null;
  }
}

/* ─── Reducer ─── */
const initialState = {
  apps: [],
  storeAccounts: { googlePlay: null, appStore: null },
  currentAppId: null,
  toasts: [],
  loaded: false,
};

function appReducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, apps: action.payload.apps, storeAccounts: action.payload.storeAccounts, loaded: true };

    case 'ADD_APP': {
      const newApp = {
        ...DEFAULT_APP,
        ...action.payload,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { ...state, apps: [...state.apps, newApp] };
    }

    case 'UPDATE_APP': {
      const { id, updates } = action.payload;
      return {
        ...state,
        apps: state.apps.map(app =>
          app.id === id
            ? { ...app, ...updates, updatedAt: new Date().toISOString() }
            : app
        ),
      };
    }

    case 'UPDATE_APP_FIELD': {
      const { id, path, value } = action.payload;
      return {
        ...state,
        apps: state.apps.map(app => {
          if (app.id !== id) return app;
          const updated = { ...app, updatedAt: new Date().toISOString() };
          const keys = path.split('.');
          let ref = updated;
          for (let i = 0; i < keys.length - 1; i++) {
            ref[keys[i]] = { ...ref[keys[i]] };
            ref = ref[keys[i]];
          }
          ref[keys[keys.length - 1]] = value;
          return updated;
        }),
      };
    }

    case 'DELETE_APP':
      return {
        ...state,
        apps: state.apps.filter(app => app.id !== action.payload),
        currentAppId: state.currentAppId === action.payload ? null : state.currentAppId,
      };

    case 'DUPLICATE_APP': {
      const source = state.apps.find(app => app.id === action.payload);
      if (!source) return state;
      const dup = {
        ...structuredClone(source),
        id: crypto.randomUUID(),
        name: `${source.name} (복사본)`,
        shared: {
          ...structuredClone(source.shared),
          appName: `${source.shared.appName} Copy`,
        },
        status: APP_STATUSES.DRAFT,
        builds: { android: null, ios: null },
        deployments: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { ...state, apps: [...state.apps, dup] };
    }

    case 'SET_CURRENT_APP':
      return { ...state, currentAppId: action.payload };

    case 'UPDATE_STORE_ACCOUNTS':
      return { ...state, storeAccounts: { ...state.storeAccounts, ...action.payload } };

    case 'ADD_TOAST': {
      const toast = {
        id: crypto.randomUUID(),
        message: action.payload.message,
        type: action.payload.type || 'info',
        duration: action.payload.duration || 4000,
      };
      return { ...state, toasts: [...state.toasts, toast] };
    }

    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) };

    default:
      return state;
  }
}

/* ─── Provider ─── */
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const saveTimer = useRef(null);
  const lastSaved = useRef('');

  // Initial hydrate: load from server, with one-time legacy localStorage migration
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const server = await fetchState();

        const migrated = localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
        const legacy = readLegacyLocal();
        const serverEmpty = server.apps.length === 0
          && !server.storeAccounts.googlePlay
          && !server.storeAccounts.appStore;

        if (!migrated && legacy && !serverEmpty) {
          // Server already has data — just mark migrated, don't overwrite
          localStorage.setItem(MIGRATION_FLAG_KEY, '1');
        }

        if (!migrated && legacy && serverEmpty) {
          // Push legacy data to server
          await pushState(legacy);
          localStorage.setItem(MIGRATION_FLAG_KEY, '1');
          if (!cancelled) {
            dispatch({ type: 'HYDRATE', payload: legacy });
            lastSaved.current = JSON.stringify({ apps: legacy.apps, storeAccounts: legacy.storeAccounts });
          }
          return;
        }

        if (!cancelled) {
          dispatch({ type: 'HYDRATE', payload: server });
          lastSaved.current = JSON.stringify({ apps: server.apps, storeAccounts: server.storeAccounts });
        }
      } catch (e) {
        console.error('서버에서 앱 정보를 불러오지 못했습니다:', e);
        // Fallback to legacy local data so user isn't blocked if server is down
        const legacy = readLegacyLocal();
        if (!cancelled && legacy) {
          dispatch({ type: 'HYDRATE', payload: legacy });
        } else if (!cancelled) {
          dispatch({ type: 'HYDRATE', payload: { apps: [], storeAccounts: { googlePlay: null, appStore: null } } });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced save to server on change (after initial hydrate)
  useEffect(() => {
    if (!state.loaded) return;
    const snapshot = JSON.stringify({ apps: state.apps, storeAccounts: state.storeAccounts });
    if (snapshot === lastSaved.current) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      pushState(state)
        .then(() => { lastSaved.current = snapshot; })
        .catch(e => console.error('서버 저장 실패:', e));
    }, 300);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state.apps, state.storeAccounts, state.loaded]);

  // Auto-remove toasts
  useEffect(() => {
    if (state.toasts.length === 0) return;
    const latest = state.toasts[state.toasts.length - 1];
    const timer = setTimeout(() => {
      dispatch({ type: 'REMOVE_TOAST', payload: latest.id });
    }, latest.duration);
    return () => clearTimeout(timer);
  }, [state.toasts]);

  const currentApp = state.apps.find(a => a.id === state.currentAppId) || null;

  const addToast = useCallback((message, type = 'info') => {
    dispatch({ type: 'ADD_TOAST', payload: { message, type } });
  }, []);

  const value = {
    apps: state.apps,
    currentApp,
    currentAppId: state.currentAppId,
    storeAccounts: state.storeAccounts,
    toasts: state.toasts,
    loaded: state.loaded,
    dispatch,
    addToast,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}

export default AppContext;
