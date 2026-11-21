import React from 'react';

export interface KeyboardShortcutBadgeProps {
  /** One or more keys to display, e.g. "C" or ["↑", "↓"]. */
  keys: string | string[];
  /** Human-readable action shown next to the key. */
  label: string;
  className?: string;
}

/** A visible <kbd> badge for a keyboard shortcut, with an accessible name. */
export const KeyboardShortcutBadge: React.FC<KeyboardShortcutBadgeProps> = ({
  keys,
  label,
  className = '',
}) => {
  const keyList = Array.isArray(keys) ? keys : [keys];

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={`${label}: ${keyList.join('+')}`}>
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {keyList.map((key, index) => (
          <React.Fragment key={`${key}-${index}`}>
            {index > 0 ? <span className="text-slate-600">+</span> : null}
            <kbd className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-slate-200 shadow-sm">
              {key}
            </kbd>
          </React.Fragment>
        ))}
      </span>
      <span className="text-slate-500" aria-hidden="true">
        {label}
      </span>
    </span>
  );
};

export interface TableShortcutHintsProps {
  /** When set, shows a `C` badge and announces what `C` copies. */
  copyLabel?: string;
  /** When set, shows an `Enter` badge and announces what `Enter` opens. */
  detailsLabel?: string;
  className?: string;
}

/**
 * Compact shortcut legend for interactive tables. Visible badges help power
 * users; the sr-only summary gives assistive tech the same information once.
 * Only the shortcuts actually supported by the table are rendered.
 */
export const TableShortcutHints: React.FC<TableShortcutHintsProps> = ({
  copyLabel,
  detailsLabel,
  className = '',
}) => {
  const summaryParts = ['Table shortcuts: use Up and Down arrows to select a row'];
  if (copyLabel) summaryParts.push(`C to ${copyLabel.toLowerCase()}`);
  if (detailsLabel) summaryParts.push(`Enter to ${detailsLabel.toLowerCase()}`);
  const summary = `${summaryParts.join(', ')}.`;

  return (
    <span
      data-testid="table-shortcut-hints"
      className={`inline-flex items-center gap-3 whitespace-nowrap text-[10px] text-slate-500 ${className}`}
    >
      <span className="sr-only">{summary}</span>
      <span aria-hidden="true" className="inline-flex items-center gap-3">
        <KeyboardShortcutBadge keys={['↑', '↓']} label="select row" />
        {copyLabel ? <KeyboardShortcutBadge keys="C" label="copy" /> : null}
        {detailsLabel ? <KeyboardShortcutBadge keys="Enter" label="details" /> : null}
      </span>
    </span>
  );
};

export default TableShortcutHints;
