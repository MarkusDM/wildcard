import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';

type FantasySelectOption<T extends string | number> = {
  label: string;
  value: T;
};

type FantasySelectProps<T extends string | number> = {
  id?: string;
  value: T;
  options: Array<FantasySelectOption<T>>;
  onChange: (value: T) => void;
  placeholder?: string;
};

export function FantasySelect<T extends string | number>({
  id,
  value,
  options,
  onChange,
  placeholder,
}: FantasySelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div ref={rootRef} className={`fantasy-dropdown ${open ? 'fantasy-dropdown--open' : ''}`}>
      <button
        id={id}
        type="button"
        className="fantasy-dropdown__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="fantasy-dropdown__value">{selected?.label ?? placeholder ?? ''}</span>
        <span className="fantasy-dropdown__caret" aria-hidden="true" />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fantasy-dropdown__menu"
            role="listbox"
            aria-labelledby={id}
          >
            {options.map((option) => {
              const active = option.value === value;

              return (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`fantasy-dropdown__option ${active ? 'fantasy-dropdown__option--active' : ''}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
