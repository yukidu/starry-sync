import React, { useEffect, useRef, useState } from 'react';

type Option = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export default function FancySelect({ value, options, onChange, placeholder='請選擇', disabled=false }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, []);

  return <div className={`fancy-select ${open ? 'open' : ''}`} ref={root}>
    <button
      type="button"
      className="fancy-select-trigger"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen(current => !current)}
    >
      <span className="fancy-select-value">
        <b>{selected?.label || placeholder}</b>
        {selected?.hint && <small>{selected.hint}</small>}
      </span>
      <span className="fancy-select-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="fancy-select-menu" role="listbox">
      {options.map(option => <button
        key={option.value}
        type="button"
        role="option"
        aria-selected={option.value === value}
        className={`fancy-select-option ${option.value === value ? 'selected' : ''}`}
        onClick={() => {
          onChange(option.value);
          setOpen(false);
        }}
      >
        <span><b>{option.label}</b>{option.hint && <small>{option.hint}</small>}</span>
        {option.value === value && <span className="fancy-select-check">✓</span>}
      </button>)}
    </div>}
  </div>;
}
