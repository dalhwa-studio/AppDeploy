import React from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../../hooks/useAppContext';

const TOAST_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export default function ToastContainer() {
  const { toasts, dispatch } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(toast => {
        const Icon = TOAST_ICONS[toast.type] || Info;
        return (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <Icon size={18} />
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
              className="btn-icon"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', padding: 2 }}
              onClick={() => dispatch({ type: 'REMOVE_TOAST', payload: toast.id })}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
