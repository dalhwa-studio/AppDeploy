import React from 'react';
import { STATUS_CONFIG } from '../../utils/constants';

export default function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;

  return (
    <span className={`badge ${config.badgeClass}`}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: config.color,
          display: 'inline-block',
        }}
      />
      {config.label}
    </span>
  );
}
