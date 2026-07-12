import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CaretIcon } from './icons';

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  'aria-label': string;
  /** Shown when value is '' (the empty choice stays selectable). */
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
  className?: string;
  /**
   * Explicit trigger width (for form contexts, '100%'). When omitted the
   * trigger sizes itself to its longest option, clamped to sane bounds,
   * so it is stable across selections without wasting space.
   */
  width?: number | string;
  /** Set false to drop the selectable empty choice, for required fields. */
  allowEmpty?: boolean;
}

/**
 * The app's dropdown: a quiet trigger and a custom-designed panel
 * (native select popups cannot be styled). Click or Enter opens; arrows
 * move; Enter picks; Escape and outside clicks close.
 */
export function Dropdown({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  placeholder = '(none)',
  mono = false,
  disabled = false,
  className = '',
  width,
  allowEmpty = true,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});

  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const maxHeight = Math.min(280, Math.max(below - 12, 160));
      const openUp = below < 180 && rect.top > below;
      setPosition({
        position: 'fixed',
        left: rect.left,
        minWidth: rect.width,
        maxHeight,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    }
    setHighlight(Math.max(0, options.findIndex((o) => o.value === value)));
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, options, value]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger${mono ? ' mono' : ''}${open ? ' open' : ''}${width === undefined ? ' auto-size' : ''} ${className}`}
        style={width !== undefined ? { width } : undefined}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="dropdown-box">
          <span className="dropdown-sizer" aria-hidden>
            {[...(allowEmpty ? [placeholder] : []), ...options.map((o) => o.label)].map((label, i) => (
              <span key={i}>{label}</span>
            ))}
          </span>
          <span className={`dropdown-value${current ? '' : ' empty'}`}>{current?.label ?? placeholder}</span>
        </span>
        <CaretIcon className="dropdown-caret" />
      </button>
      {open &&
        createPortal(
          <div ref={panelRef} className="dropdown-panel" style={position} role="listbox" aria-label={ariaLabel}>
            {allowEmpty && (
              <button
                type="button"
                role="option"
                aria-selected={value === ''}
                className={`dropdown-option empty${highlight === -1 ? ' highlight' : ''}`}
                onClick={() => pick('')}
              >
                {placeholder}
              </button>
            )}
            {options.map((option, i) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`dropdown-option${mono ? ' mono' : ''}${i === highlight ? ' highlight' : ''}${option.value === value ? ' selected' : ''}`}
                onPointerEnter={() => setHighlight(i)}
                onClick={() => pick(option.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlight((h) => Math.min(options.length - 1, h + 1));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlight((h) => Math.max(0, h - 1));
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    pick(options[highlight]?.value ?? option.value);
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
