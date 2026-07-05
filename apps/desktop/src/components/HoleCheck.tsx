import type { ChangeEventHandler } from 'react';

interface HoleCheckProps {
  checked: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  'aria-label': string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

/**
 * The app's checkbox: a rimmed punchcard hole that is punched (a cyan
 * centre) when checked. A real input carries the state, the label and
 * keyboard behaviour; the hole is its visible face.
 */
export function HoleCheck({
  checked,
  onChange,
  'aria-label': ariaLabel,
  disabled = false,
  readOnly = false,
  className = '',
}: HoleCheckProps) {
  return (
    <span className={`hole-check ${className}`.trim()}>
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        readOnly={readOnly}
        {...(onChange !== undefined ? { onChange } : {})}
      />
      <span className="hole-mark" aria-hidden />
    </span>
  );
}
