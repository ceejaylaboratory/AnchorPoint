import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  BadgeDollarSign,
  Check,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Landmark,
} from 'lucide-react';

export type AssetOption = {
  code: string;
  name: string;
  subtitle: string;
};

interface AssetDropdownProps {
  label: string;
  options: AssetOption[];
  value: string;
  onChange: (value: string) => void;
}

const assetIcons = {
  USDC: CircleDollarSign,
  EURT: Landmark,
  ARST: BadgeDollarSign,
} as const;

const getAssetIcon = (code: string) => assetIcons[code as keyof typeof assetIcons] ?? Coins;

export const AssetDropdown = ({ label, options, value, onChange }: AssetDropdownProps) => {
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.code === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex] ?? options[0];
  const SelectedIcon = getAssetIcon(selectedOption.code);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  const chooseOption = (index: number) => {
    const nextOption = options[index];
    if (!nextOption) return;

    onChange(nextOption.code);
    setActiveIndex(index);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (!open) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => {
        const offset = event.key === 'ArrowDown' ? 1 : -1;
        return (current + offset + options.length) % options.length;
      });
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseOption(activeIndex);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-2 block text-sm font-medium text-slate-300">
        {label}
      </label>

      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left transition-all hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary"
            aria-hidden="true"
          >
            <SelectedIcon size={20} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-100">
              {selectedOption.code}
            </span>
            <span className="block truncate text-xs text-slate-400">
              {selectedOption.subtitle}
            </span>
          </span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-slate-700 bg-slate-950 p-1 shadow-2xl shadow-slate-950/60"
        >
          {options.map((option, index) => {
            const isSelected = option.code === selectedOption.code;
            const isActive = index === activeIndex;
            const OptionIcon = getAssetIcon(option.code);

            return (
              <button
                key={option.code}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseOption(index)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  isActive ? 'bg-slate-800' : 'hover:bg-slate-900'
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      isSelected ? 'bg-primary/25 text-primary' : 'bg-slate-800 text-slate-300'
                    }`}
                    aria-hidden="true"
                  >
                    <OptionIcon size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {option.code}
                      <span className="ml-2 font-normal text-slate-500">{option.name}</span>
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {option.subtitle}
                    </span>
                  </span>
                </span>
                {isSelected && <Check size={16} className="shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AssetDropdown;
