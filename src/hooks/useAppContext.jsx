import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { DEFAULT_APP, APP_STATUSES } from '../utils/constants';

const AppContext = createContext(null);

/* ─── Local Storage Persistence ─── */
const STORAGE_KEY = 'appdeploy_data';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        apps: data.apps || [],
        storeAccounts: data.storeAccounts || { googlePlay: null, appStore: null },
      };
    }
  } catch (e) {
    console.error('Failed to load data from localStorage:', e);
  }
  return { apps: [], storeAccounts: { googlePlay: null, appStore: null } };
}

function saveToStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      apps: state.apps,
      storeAccounts: state.storeAccounts,
    }));
  } catch (e) {
    console.error('Failed to save data to localStorage:', e);
  }
}

/* ─── Reducer ─── */
const initialState = {
  ...loadFromStorage(),
  currentAppId: null,
  toasts: [],
};

function appReducer(state, action) {
  switch (action.type) {
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
          // Support nested paths like 'shared.appName'
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

  // Persist to localStorage on change
  useEffect(() => {
    saveToStorage(state);
  }, [state.apps, state.storeAccounts]);

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
