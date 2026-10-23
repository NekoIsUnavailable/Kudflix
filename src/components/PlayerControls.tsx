import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Play, Pause, RotateCcw, RotateCw, Volume1, Volume2, VolumeX,
  Maximize, Minimize, SkipBack, SkipForward, Captions, Gauge,
} from 'lucide-react';
import { AudioSubtitlePanel, SpeedPanel } from './TrackMenu';
import {
  formatTime,
  PLAYER_VOLUME_MAX,
  PLAYER_VOLUME_REFERENCE,
  snapPlayerVolume,
  type SubtitleStyle,
} from '../utils/subtitles';

/** Two-segment slider: white = 0–100%, amber = 100–150% boost zone. */
function VolumeSlider({
  value,
  onChange,
  onDraggingChange,
}: {
  value: number;
  onChange: (n: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const prevRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  const splitPct = (PLAYER_VOLUME_REFERENCE / PLAYER_VOLUME_MAX) * 100;
  const fillPct = (value / PLAYER_VOLUME_MAX) * 100;
  const normalFillPct = Math.min(fillPct, splitPct);
  const boostFillPct = fillPct > splitPct ? fillPct - splitPct : 0;
  const boosted = value > PLAYER_VOLUME_REFERENCE;

  useEffect(() => {
    prevRef.current = value;
  }, [value]);

  const setDraggingState = (next: boolean) => {
    setDragging(next);
    onDraggingChange?.(next);
  };

  const handleChange = (raw: number) => {
    const prev = prevRef.current;
    const next = snapPlayerVolume(raw, prev);
    prevRef.current = next;
    onChange(next);
  };

  return (
    <div
      className="flex items-center gap-2 shrink-0 ml-1"
      title={boosted ? `Volume ${value}% (boosted)` : `Volume ${value}%`}
    >
      <div className="relative w-[7.5rem] h-5 flex items-center shrink-0">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full overflow-hidden flex pointer-events-none">
        <div className="h-full bg-white/25" style={{ width: `${splitPct}%` }} />
        <div
          className="h-full bg-amber-500/25 border-l border-amber-400/40"
          style={{ width: `${100 - splitPct}%` }}
        />
      </div>
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full overflow-hidden pointer-events-none">
        <div className="absolute left-0 top-0 h-full bg-white rounded-l-full" style={{ width: `${normalFillPct}%` }} />
        {boostFillPct > 0 && (
          <div
            className="absolute top-0 h-full bg-amber-400 rounded-r-full"
            style={{ left: `${splitPct}%`, width: `${boostFillPct}%` }}
          />
        )}
      </div>
      <div
        className="absolute top-1/2 -translate-y-1/2 h-3 w-px bg-white/35 pointer-events-none"
        style={{ left: `${splitPct}%` }}
        aria-hidden
      />
      <input
        type="range"
        min={0}
        max={PLAYER_VOLUME_MAX}
        value={value}
        onChange={(e) => handleChange(Number(e.target.value))}
        onInput={(e) => handleChange(Number((e.target as HTMLInputElement).value))}
        onPointerDown={(e) => {
          setDraggingState(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          setDraggingState(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={(e) => {
          setDraggingState(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onBlur={() => setDraggingState(false)}
        className="player-volume-range absolute inset-0 w-full cursor-pointer"
        aria-label="Volume"
        aria-valuetext={boosted ? `${value} percent, boosted` : `${value} percent`}
      />
      </div>
      <div
        className={`shrink-0 transition-opacity duration-150 ${
          dragging ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden pointer-events-none'
        }`}
        aria-hidden={!dragging}
      >
        <span
          className={`inline-flex items-center justify-center min-w-[2.5rem] px-1.5 py-0.5 rounded text-[11px] leading-tight font-bold tabular-nums shadow-md ${
            boosted ? 'bg-amber-500/90 text-black' : 'bg-white/95 text-black'
          }`}
        >
          {value}%
        </span>
      </div>
    </div>
  );
}

export type PlayerPanel = 'tracks' | 'speed' | null;

interface ProgressBarProps {
  timePos: number;
  duration: number;
  playing: boolean;
  speed: number;
  onSeek: (time: number) => void;
  onScrubbingChange: (scrubbing: boolean) => void;
}

function getCssZoom(el: HTMLElement | null): number {
  let zoom = 1;
  while (el) {
    const value = getComputedStyle(el).zoom;
    if (value && value !== 'normal') {
      const parsed = parseFloat(value);
      if (!Number.isNaN(parsed) && parsed > 0) zoom *= parsed;
    }
    el = el.parentElement;
  }
  return zoom;
}

function ProgressBar({ timePos, duration, playing, speed, onSeek, onScrubbingChange }: ProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const remainingRef = useRef<HTMLSpanElement>(null);
  const currentRef = useRef<HTMLSpanElement>(null);
  const base = useRef({ time: timePos, at: performance.now() });
  const pendingSeek = useRef<{ time: number; until: number } | null>(null);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [hover, setHover] = useState<{ pct: number; time: number } | null>(null);

  useEffect(() => {
    const pending = pendingSeek.current;
    if (pending && Math.abs(timePos - pending.time) > 1.5 && performance.now() < pending.until) return;
    pendingSeek.current = null;
    base.current = { time: timePos, at: performance.now() };
  }, [timePos]);

  useEffect(() => {
    if (!playing) base.current = { time: base.current.time, at: performance.now() };
  }, [playing]);

  useEffect(() => {
    let frame = 0;
    const render = () => {
      let t: number;
      if (scrubTime !== null) {
        t = scrubTime;
      } else if (pendingSeek.current) {
        t = pendingSeek.current.time;
      } else {
        const { time, at } = base.current;
        t = playing ? Math.min(time + ((performance.now() - at) / 1000) * speed, time + 1) : time;
      }
      if (duration > 0) t = Math.min(t, duration);
      const pct = duration > 0 ? (t / duration) * 100 : 0;
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${pct}%`;
      if (remainingRef.current) remainingRef.current.textContent = formatTime(Math.max(0, duration - t));
      if (currentRef.current) currentRef.current.textContent = formatTime(Math.max(0, t));
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, duration, scrubTime]);

  const timeAt = (clientX: number) => {
    const track = trackRef.current!;
    const bar = track.querySelector('[data-progress-bar]') as HTMLElement | null;
    const el = bar ?? track;
    const rect = el.getBoundingClientRect();
    const zoom = getCssZoom(track);
    const trackWidth = zoom !== 1 ? el.offsetWidth * zoom : rect.width;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / trackWidth));
    return { time: ratio * duration, pct: ratio * 100 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubTime(timeAt(e.clientX).time);
    onScrubbingChange(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (duration <= 0) return;
    const pos = timeAt(e.clientX);
    setHover(pos);
    if (scrubTime !== null) setScrubTime(pos.time);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (scrubTime === null) return;
    const { time } = timeAt(e.clientX);
    pendingSeek.current = { time, until: performance.now() + 2500 };
    base.current = { time, at: performance.now() };
    setScrubTime(null);
    onScrubbingChange(false);
    onSeek(time);
  };

  const tooltip = scrubTime !== null && hover ? { ...hover, time: scrubTime } : hover;

  return (
    <div className="flex items-center gap-4">
      <span ref={currentRef} className="text-white text-sm font-medium tabular-nums min-w-[3.5rem] text-left">
        {formatTime(Math.max(0, timePos))}
      </span>
      <div
        ref={trackRef}
        className="group/bar relative flex-1 h-5 flex items-center cursor-pointer touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <div
          data-progress-bar
          className={`relative w-full bg-white/25 transition-[height] duration-150 ${scrubTime !== null ? 'h-2' : 'h-1 group-hover/bar:h-2'}`}
        >
          {hover && (
            <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${hover.pct}%` }} />
          )}
          <div ref={fillRef} className="absolute inset-y-0 left-0 bg-accent" />
        </div>
        <div
          ref={thumbRef}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-lg transition-transform duration-150 ${
            scrubTime !== null ? 'w-5 h-5 scale-110' : 'w-4 h-4 scale-0 group-hover/bar:scale-100'
          }`}
        />
        {tooltip && (
          <div
            className="absolute bottom-7 -translate-x-1/2 px-2 py-1 rounded bg-black/85 text-white text-sm font-semibold tabular-nums pointer-events-none"
            style={{ left: `${tooltip.pct}%` }}
          >
            {formatTime(tooltip.time)}
          </div>
        )}
      </div>
      <span ref={remainingRef} className="text-white text-sm font-medium tabular-nums min-w-[3.5rem] text-right">
        {formatTime(Math.max(0, duration - timePos))}
      </span>
    </div>
  );
}

function IconButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative flex items-center justify-center w-11 h-11 text-white cursor-pointer transition-transform duration-150 hover:scale-125 focus:outline-none ${active ? 'scale-125' : ''}`}
    >
      {children}
    </button>
  );
}

function SkipIcon({ direction }: { direction: 'back' | 'forward' }) {
  const Icon = direction === 'back' ? RotateCcw : RotateCw;
  return (
    <span className="relative flex items-center justify-center">
      <Icon className="w-9 h-9" strokeWidth={1.75} />
      <span className="absolute text-[10px] font-extrabold pt-0.5">10</span>
    </span>
  );
}

interface PlayerControlsProps {
  title: string;
  subtitle?: string;
  state: PlayerState;
  volume: number;
  muted: boolean;
  visible: boolean;
  isFullscreen: boolean;
  openPanel: PlayerPanel;
  audioTracks: MpvTrack[];
  subtitleTracks: MpvTrack[];
  selectedAudioId: number | null;
  selectedSubtitleId: number | null;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPanelChange: (panel: PlayerPanel) => void;
  onBack: () => void;
  onTogglePause: () => void;
  onSeek: (time: number) => void;
  onSkip: (delta: number) => void;
  onVolumeChange: (volume: number) => void;
  onMute: () => void;
  onSpeedChange: (speed: number) => void;
  onSelectAudio: (id: number) => void;
  onSelectSubtitle: (id: number | null) => void;
  onImportSubtitle: () => void;
  subtitleStyle: SubtitleStyle;
  onSubtitleStyleChange: (style: SubtitleStyle) => void;
  onFullscreen: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onScrubbingChange: (scrubbing: boolean) => void;
}

export function PlayerControls(props: PlayerControlsProps) {
  const {
    title, subtitle, state, volume, muted, visible, isFullscreen, openPanel,
    audioTracks, subtitleTracks, selectedAudioId, selectedSubtitleId, hasPrev, hasNext,
    onPanelChange, onBack, onTogglePause, onSeek, onSkip, onVolumeChange, onMute,
    onSpeedChange, onSelectAudio, onSelectSubtitle, onImportSubtitle,
    subtitleStyle, onSubtitleStyleChange, onFullscreen, onPrev, onNext,
    onScrubbingChange,
  } = props;

  const effectiveVolume = muted ? 0 : volume;
  const [volumeDragging, setVolumeDragging] = useState(false);
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 50 ? Volume1 : Volume2;
  const togglePanel = (panel: Exclude<PlayerPanel, null>) => onPanelChange(openPanel === panel ? null : panel);
  const closePanel = () => onPanelChange(null);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className={`absolute inset-0 transition-opacity duration-300 pointer-events-none ${visible ? 'opacity-100' : 'opacity-0'}`}>
      {openPanel && (
        <div
          className="fixed inset-0 z-30 pointer-events-auto"
          onClick={closePanel}
          aria-hidden
        />
      )}

      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 p-6 md:px-10 pointer-events-auto" onClick={stop} onDoubleClick={stop}>
        <button
          onClick={onBack}
          aria-label="Back"
          className="text-white transition-transform duration-150 hover:scale-125"
        >
          <ArrowLeft className="w-10 h-10" strokeWidth={2} />
        </button>
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 inset-x-0 h-48 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
      <div className="absolute bottom-0 inset-x-0 px-6 md:px-10 pb-5 pointer-events-auto" onClick={stop} onDoubleClick={stop}>
        <ProgressBar
          timePos={state.timePos}
          duration={state.duration}
          playing={!state.pause && state.loaded && !state.buffering}
          speed={state.speed}
          onSeek={onSeek}
          onScrubbingChange={onScrubbingChange}
        />

        <div className="mt-3 flex items-center gap-2 md:gap-4">
          <IconButton label={state.pause ? 'Play (Space)' : 'Pause (Space)'} onClick={onTogglePause}>
            {state.pause ? <Play className="w-9 h-9 fill-white" /> : <Pause className="w-9 h-9 fill-white" />}
          </IconButton>
          <IconButton label="Back 10 seconds (←)" onClick={() => onSkip(-10)}>
            <SkipIcon direction="back" />
          </IconButton>
          <IconButton label="Forward 10 seconds (→)" onClick={() => onSkip(10)}>
            <SkipIcon direction="forward" />
          </IconButton>

          <div className="group/vol relative shrink-0">
            <IconButton label={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={onMute}>
              <VolumeIcon className="w-9 h-9" />
            </IconButton>
            <div
              className={`absolute left-[calc(100%+2px)] top-1/2 -translate-y-1/2 z-30 transition-opacity duration-200 ${
                volumeDragging
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none group-hover/vol:opacity-100 group-hover/vol:pointer-events-auto'
              }`}
            >
              <VolumeSlider
                value={effectiveVolume}
                onChange={onVolumeChange}
                onDraggingChange={setVolumeDragging}
              />
            </div>
          </div>

          <div className="flex-1 min-w-0 text-center px-4 truncate pointer-events-none">
            <span className="text-white text-lg font-bold">{title}</span>
            {subtitle && <span className="text-white/70 text-lg ml-3">{subtitle}</span>}
          </div>

          {hasPrev && onPrev && (
            <IconButton label="Previous episode (Shift+P)" onClick={onPrev}>
              <SkipBack className="w-9 h-9 fill-white" />
            </IconButton>
          )}

          {hasNext && onNext && (
            <IconButton label="Next episode (Shift+N)" onClick={onNext}>
              <SkipForward className="w-9 h-9 fill-white" />
            </IconButton>
          )}

          <div className="relative">
            <IconButton label="Audio & Subtitles (C)" onClick={() => togglePanel('tracks')} active={openPanel === 'tracks'}>
              <Captions className="w-9 h-9" />
            </IconButton>
            {openPanel === 'tracks' && (
              <div
                className="absolute bottom-full right-0 mb-4 z-40 bg-[#262626]/95 rounded-md shadow-2xl backdrop-blur-sm pointer-events-auto"
                onClick={stop}
                onDoubleClick={stop}
              >
                <AudioSubtitlePanel
                  audioTracks={audioTracks}
                  subtitleTracks={subtitleTracks}
                  selectedAudioId={selectedAudioId}
                  selectedSubtitleId={selectedSubtitleId}
                  subtitleStyle={subtitleStyle}
                  onSelectAudio={onSelectAudio}
                  onSelectSubtitle={onSelectSubtitle}
                  onImportSubtitle={onImportSubtitle}
                  onSubtitleStyleChange={onSubtitleStyleChange}
                  onClose={closePanel}
                />
              </div>
            )}
          </div>

          <div className="relative">
            <IconButton label="Playback speed" onClick={() => togglePanel('speed')} active={openPanel === 'speed'}>
              <Gauge className="w-9 h-9" />
            </IconButton>
            {openPanel === 'speed' && (
              <div
                className="absolute bottom-full right-0 mb-4 z-40 bg-[#262626]/95 rounded-md shadow-2xl backdrop-blur-sm pointer-events-auto"
                onClick={stop}
                onDoubleClick={stop}
              >
                <SpeedPanel speed={state.speed} onSelect={onSpeedChange} onClose={closePanel} />
              </div>
            )}
          </div>

          <IconButton label={isFullscreen ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={onFullscreen}>
            {isFullscreen ? <Minimize className="w-9 h-9" /> : <Maximize className="w-9 h-9" />}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
