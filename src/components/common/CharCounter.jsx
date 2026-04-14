import React from 'react';

export default function CharCounter({ current, max, className = '' }) {
  const ratio = current / max;
  let stateClass = '';
  if (ratio >= 1) stateClass = 'error';
  else if (ratio >= 0.9) stateClass = 'warning';

  return (
    <span className={`char-counter ${stateClass} ${className}`}>
      {current.toLocaleString()} / {max.toLocaleString()}
    </span>
  );
}
