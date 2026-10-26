import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export type ThemedSelectOption<T extends string> = { value: T; label: string };

export const GRID_SORT_OPTIONS: ThemedSelectOption<
  'az' | 'za' | 'year-new' | 'year-old' | 'recent' | 'duration-short' | 'duration-long'
>[] = [
  { value: 'az', label: 'A–Z' },
  { value: 'za', label: 'Z–A' },
  { value: 'year-new', label: 'Newest year' },
  { value: 'year-old', label: 'Oldest year' },
  { value: 'recent', label: 'Recently added' },
  { value: 'duration-short', label: 'Shortest' },
  { value: 'duration-long', label: 'Longest' },
];

export const GRID_FILTER_OPTIONS: ThemedSelectOption<'all' | 'unwatched' | 'watched'>[] = [
  { value: 'all', label: 'All' },
  { value: 'unwatched', label: 'Unwatched' },
  { value: 'watched', label: 'Watched' },
];

export const LIST_KIND_OPTIONS: ThemedSelectOption<'movie' | 'tv'>[] = [
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV Shows' },
];

export const WATCHED_INDICATOR_OPTIONS: ThemedSelectOption<'always' | 'hover' | 'never'>[] = [
  { value: 'always', label: 'Always show' },
  { value: 'hover', label: 'On hover' },
  { value: 'never', label: 'Never show' },
];

export const DETAIL_MODAL_ACTIONS_OPTIONS: ThemedSelectOption<'icons' | 'menu'>[] = [
  { value: 'menu', label: '⋯ overflow menu' },
  { value: 'icons', label: 'Icons only' },
];

export const WATCH_ONLINE_NAV_OPTIONS: ThemedSelectOption<'text' | 'icon' | 'hidden'>[] = [
  { value: 'text', label: 'Text tab' },
  { value: 'icon', label: 'Icon' },
  { value: 'hidden', label: 'Hidden' },
];

export const DISCORD_ACTIVITY_STYLE_OPTIONS: ThemedSelectOption<'watching' | 'media' | 'playing'>[] = [
  { value: 'watching', label: 'Watching (progress bar)' },
  { value: 'media', label: 'Listening (progress bar)' },
  { value: 'playing', label: 'Playing' },
];

export function ThemedSelect<T extends string>({
  value,
  onChange,
  options,
  disabled = false,
  className = '',
  buttonClassName = '',
  menuZIndex = 200,
  menuPlacement = 'below',
}: {
  value: T;
  onChange: (v: T) => void;
  options: ThemedSelectOption<T>[];
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuZIndex?: number;
  /** Open menu above the button when space below is tight (e.g. modal footers). */
  menuPlacement?: 'below' | 'above';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-between gap-2 bg-[#242424] border rounded px-4 py-2 text-sm font-semibold text-white outline-none transition disabled:opacity-50 ${
          buttonClassName.includes('w-') ? '' : 'w-full min-w-[8rem]'
        } ${open ? 'border-white' : 'border-gray-600 hover:border-gray-400'} ${buttonClassName}`}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          className={`absolute left-0 right-0 bg-[#242424] border border-gray-600 rounded shadow-[0_4px_20px_rgba(0,0,0,0.5)] max-h-52 overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent ${
            menuPlacement === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
          style={{ zIndex: menuZIndex }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-2.5 text-sm font-semibold transition ${
                opt.value === value
                  ? 'text-white bg-white/10'
                  : 'text-gray-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
