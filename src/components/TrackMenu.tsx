import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, FilePlus2, X } from 'lucide-react';
import { audioTrackLabel, subtitleTrackLabel, type SubtitleStyle } from '../utils/subtitles';

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-6 pt-5 pb-3">
      <h3 className="text-xl font-bold text-white">{title}</h3>
      <button
        onClick={onClose}
        aria-label="Close"
        className="text-white/60 hover:text-white transition-colors p-1 -mr-1 rounded hover:bg-white/10"
      >
        <X className="w-6 h-6" />
      </button>
    </div>
  );
}

function Option({ selected, main, detail, onClick }: { selected: boolean; main: string; detail?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-2 text-left rounded transition-colors ${
        selected ? 'text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
      }`}
    >
      <span className="w-5 flex-shrink-0 pt-0.5">{selected && <Check className="w-5 h-5" strokeWidth={3} />}</span>
      <span className="min-w-0">
        <span className="block text-base font-semibold leading-snug truncate">{main}</span>
        {detail && <span className="block text-xs text-white/40 truncate">{detail}</span>}
      </span>
    </button>
  );
}

function StyleRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="px-4 py-2">
      <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition-colors ${
              value === opt.value ? 'bg-white text-black' : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface AudioSubtitlePanelProps {
  audioTracks: MpvTrack[];
  subtitleTracks: MpvTrack[];
  selectedAudioId: number | null;
  selectedSubtitleId: number | null;
  subtitleStyle: SubtitleStyle;
  onSelectAudio: (id: number) => void;
  onSelectSubtitle: (id: number | null) => void;
  onImportSubtitle: () => void;
  onSubtitleStyleChange: (style: SubtitleStyle) => void;
  onClose: () => void;
}

export function AudioSubtitlePanel({
  audioTracks,
  subtitleTracks,
  selectedAudioId,
  selectedSubtitleId,
  subtitleStyle,
  onSelectAudio,
  onSelectSubtitle,
  onImportSubtitle,
  onSubtitleStyleChange,
  onClose,
}: AudioSubtitlePanelProps) {
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const patchStyle = (patch: Partial<SubtitleStyle>) => onSubtitleStyleChange({ ...subtitleStyle, ...patch });

  return (
    <div className="flex flex-col w-[min(720px,90vw)] max-h-[min(520px,70vh)]">
      <PanelHeader title="Audio & Subtitles" onClose={onClose} />
      <div className="flex min-h-0 flex-1">
      <div className="flex-1 min-w-0 flex flex-col border-r border-white/10">
        <h4 className="px-6 pt-1 pb-2 text-sm font-bold text-white/60 uppercase tracking-wide">Audio</h4>
        <div className="overflow-y-auto px-2 pb-4 player-scroll">
          {audioTracks.length === 0 && <p className="px-4 py-2 text-white/40 text-sm">No audio tracks</p>}
          {audioTracks.map((t) => {
            const { main, detail } = audioTrackLabel(t);
            return (
              <Option key={t.id} selected={selectedAudioId === t.id} main={main} detail={detail} onClick={() => onSelectAudio(t.id)} />
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <h4 className="px-6 pt-1 pb-2 text-sm font-bold text-white/60 uppercase tracking-wide shrink-0">Subtitles</h4>
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 player-scroll">
          <Option selected={selectedSubtitleId === null} main="Off" onClick={() => onSelectSubtitle(null)} />
          {subtitleTracks.map((t) => {
            const { main, detail } = subtitleTrackLabel(t);
            return (
              <Option key={t.id} selected={selectedSubtitleId === t.id} main={main} detail={detail} onClick={() => onSelectSubtitle(t.id)} />
            );
          })}
        </div>

        <div className="shrink-0 border-t border-white/10 pt-1 pb-1">
          <button
            type="button"
            onClick={() => setAppearanceOpen((open) => !open)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left rounded text-white/80 hover:text-white hover:bg-white/5 transition-colors"
          >
            <span className="text-sm font-bold">Appearance</span>
            <ChevronDown
              className={`w-5 h-5 transition-transform duration-300 ease-in-out ${appearanceOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <AnimatePresence initial={false}>
            {appearanceOpen && (
              <motion.div
                key="appearance"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="max-h-[min(220px,28vh)] overflow-y-auto player-scroll pb-2">
                  <StyleRow
                    label="Size"
                    value={subtitleStyle.size}
                    onChange={(size) => patchStyle({ size })}
                    options={[
                      { value: 'small', label: 'Small' },
                      { value: 'default', label: 'Default' },
                      { value: 'large', label: 'Large' },
                    ]}
                  />
                  <StyleRow
                    label="Color"
                    value={subtitleStyle.color}
                    onChange={(color) => patchStyle({ color })}
                    options={[
                      { value: 'white', label: 'White' },
                      { value: 'yellow', label: 'Yellow' },
                    ]}
                  />
                  <StyleRow
                    label="Opacity"
                    value={subtitleStyle.opacity}
                    onChange={(opacity) => patchStyle({ opacity })}
                    options={[
                      { value: '100', label: '100%' },
                      { value: '75', label: '75%' },
                      { value: '50', label: '50%' },
                    ]}
                  />
                  <StyleRow
                    label="Background"
                    value={subtitleStyle.background}
                    onChange={(background) => patchStyle({ background })}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'outline', label: 'Outline' },
                      { value: 'box', label: 'Box' },
                    ]}
                  />
                  <StyleRow
                    label="Position"
                    value={subtitleStyle.position}
                    onChange={(position) => patchStyle({ position })}
                    options={[
                      { value: 'default', label: 'Default' },
                      { value: 'low', label: 'Lower' },
                      { value: 'high', label: 'Higher' },
                    ]}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="px-2 pt-1 pb-3 shrink-0 border-t border-white/10">
          <button
            onClick={onImportSubtitle}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-left rounded text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            <FilePlus2 className="w-5 h-5" />
            <span className="text-sm font-semibold">Add subtitle file…</span>
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function SpeedPanel({ speed, onSelect, onClose }: { speed: number; onSelect: (speed: number) => void; onClose: () => void }) {
  const activeIndex = Math.max(0, SPEED_OPTIONS.findIndex((s) => Math.abs(s - speed) < 0.01));
  const fill = (activeIndex / (SPEED_OPTIONS.length - 1)) * 100;

  return (
    <div className="w-[min(560px,85vw)]">
      <PanelHeader title="Playback Speed" onClose={onClose} />
      <div className="relative mx-11 mb-6">
        <div className="absolute top-[9px] left-0 right-0 h-0.5 bg-white/25" />
        <div className="absolute top-[9px] left-0 h-0.5 bg-white transition-all" style={{ width: `${fill}%` }} />
        <div className="relative flex justify-between">
          {SPEED_OPTIONS.map((s, i) => {
            const selected = i === activeIndex;
            return (
              <button key={s} onClick={() => onSelect(s)} className="group flex flex-col items-center gap-3 w-5">
                <span
                  className={`rounded-full transition-all ${
                    selected ? 'w-5 h-5 bg-white ring-4 ring-white/25' : 'w-3 h-3 mt-1 mb-1 bg-white/60 group-hover:bg-white group-hover:scale-125'
                  }`}
                />
                <span className={`text-sm whitespace-nowrap ${selected ? 'text-white font-bold' : 'text-white/60 group-hover:text-white'}`}>
                  {s === 1 ? '1x (Normal)' : `${s}x`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
