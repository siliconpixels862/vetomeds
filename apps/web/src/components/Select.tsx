'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** Optional group header — consecutive options with the same group render under one label. */
  group?: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * A hand-rolled, dependency-free listbox that always opens BELOW its trigger.
 * Keyboard: Enter/Space/ArrowDown open · ArrowUp/Down move · Enter select · Esc close.
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  label,
  className = '',
  disabled = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const listboxId = useId();

  const selectedIndex = useMemo(
    () => options.findIndex(o => o.value === value),
    [options, value]
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const openList = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [disabled, selectedIndex]);

  const commit = useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt) return;
      onChange(opt.value);
      close();
      buttonRef.current?.focus();
    },
    [options, onChange, close]
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open, close]);

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function moveActive(delta: number) {
    setActiveIndex(prev => {
      const next = prev + delta;
      if (next < 0) return options.length - 1;
      if (next >= options.length) return 0;
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        buttonRef.current?.focus();
        break;
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-left text-sm text-slate-900 transition-colors
          ${open ? 'border-sky-400 ring-4 ring-sky-400/20' : 'border-slate-200 hover:border-sky-300'}
          disabled:cursor-not-allowed disabled:opacity-55 focus:outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-400/20`}
      >
        <span className={`truncate ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="nice-scroll animate-pop-in absolute top-full left-0 right-0 z-50 mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10"
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isActive = i === activeIndex;
            const showGroup = opt.group && (i === 0 || options[i - 1].group !== opt.group);
            return (
              <Fragment key={opt.value}>
                {showGroup && (
                  <li role="presentation" className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {opt.group}
                  </li>
                )}
                <li
                  ref={el => { optionRefs.current[i] = el; }}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(i)}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors
                    ${isSelected ? 'bg-sky-50 font-medium text-sky-700' : isActive ? 'bg-slate-50 text-slate-900' : 'text-slate-700'}`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-sky-600">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
