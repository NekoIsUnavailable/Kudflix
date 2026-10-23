import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Pause, RotateCcw, RotateCw, ArrowLeft } from 'lucide-react';
import { PlayerControls, type PlayerPanel } from './PlayerControls';
import { usePlayerIdle } from '../hooks/usePlayerIdle';
import { usePlayerKeyboard } from '../hooks/usePlayerKeyboard';
import {
  getSubtitlePref, saveSubtitlePref, getAudioPref, saveAudioPref,
  loadPlayerVolumeForNewSession,
  savePlayerVolume,
  clampPlayerVolume,
  snapPlayerVolume,
  saveProgress,
  samePath,
  loadSubtitleStyle, saveSubtitleStyle, subtitleStyleToMpv, type SubtitleStyle,
} from '../utils/subtitles';

import { resolveOutroWindowSeconds } from '../utils/showSkip';
const PROGRESS_SAVE_MS = 5000;

const INITIAL_STATE: PlayerState = {
  timePos: 0,
  duration: 0,
  pause: false,
  volume: 100,
  mute: false,
  speed: 1,
  buffering: true,
  seeking: false,
  eof: false,
  loaded: false,
  error: null,
  tracks: [],
  audioId: null,
};

type Flash = { kind: 'play' | 'pause' | 'back' | 'forward'; key: number } | null;

export function VideoPlayer({ session }: { session: PlayerSession }) {
  const api = window.electronAPI;
  const [state, setState] = useState<PlayerState>(INITIAL_STATE);
  const [{ volume, muted }, setVolumeState] = useState(loadPlayerVolumeForNewSession);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [openPanel, setOpenPanel] = useState<PlayerPanel>(null);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(loadSubtitleStyle);
  const [scrubbing, setScrubbing] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [nextDismissed, setNextDismissed] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const externalSubsRef = useRef<ExternalSubtitleFile[]>([]);
  const subsInitialized = useRef(false);
  const audioReconciledPath = useRef<string | null>(null);
  const requestedNext = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedPathRef = useRef<string | null>(null);

  const error = openError ?? state.error;
  const keepVisible = state.pause || openPanel !== null || scrubbing || !state.loaded || Boolean(error);
  const { controlsVisible, poke, hide } = usePlayerIdle(keepVisible);

  const cmd = useCallback((action: string, value?: unknown) => api.playerCommand(action, value), [api]);

  const persistProgress = useCallback(() => {
    const path = loadedPathRef.current;
    if (!path || path !== session.path) return;
    const { timePos, loaded } = stateRef.current;
    if (!loaded || timePos <= 0) return;
    saveProgress(session.profileId, path, timePos);
  }, [session.profileId, session.path]);

  // Open the file once per session path
  useEffect(() => {
    let cancelled = false;
    subsInitialized.current = false;
    audioReconciledPath.current = null;
    requestedNext.current = false;
    loadedPathRef.current = null;
    setOpenError(null);

    (async () => {
      try {
        const external = typeof api?.findSubtitleFiles === 'function'
          ? await api.findSubtitleFiles(session.path).catch(() => [])
          : [];
        if (cancelled) return;
        externalSubsRef.current = external;

        const subPref = getSubtitlePref(session.profileId, session.path);
        const { volume: vol, muted: mute } = loadPlayerVolumeForNewSession();
        setVolumeState({ volume: vol, muted: mute });

        const style = loadSubtitleStyle();
        const options: PlayerOpenOptions = {
          volume: vol,
          mute,
          startTime: session.startTime > 5 ? session.startTime : 0,
          subtitleStyle: subtitleStyleToMpv(style),
        };
        if (subPref?.type === 'off' || subPref?.type === 'external' || (!subPref && external.length > 0)) {
          options.subtitleId = 'no';
        } else if (subPref?.type === 'embedded') {
          options.subtitleId = subPref.id;
        }

        const result = await api.playerOpen(session.path, options);
        if (cancelled) return;
        if (!result.ok) {
          setOpenError(result.error || 'Could not start playback.');
        } else {
          loadedPathRef.current = session.path;
          if (result.state) setState(result.state);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('[VideoPlayer] failed to open:', err);
        setOpenError(err?.message || 'Could not start playback.');
      }
    })();

    return () => {
      cancelled = true;
      persistProgress();
    };
  }, [api, session.path, session.profileId, session.startTime, persistProgress]);

  useEffect(() => {
    setNextDismissed(false);
    requestedNext.current = false;
  }, [session.path]);

  useEffect(() => api.onPlayerState(setState), [api]);
  useEffect(() => api.onPlayerFullscreen(setIsFullscreen), [api]);

  useEffect(() => {
    const id = setInterval(persistProgress, PROGRESS_SAVE_MS);
    return () => clearInterval(id);
  }, [persistProgress]);

  // Attach external subtitle files once mpv has loaded the video
  useEffect(() => {
    if (!state.loaded || subsInitialized.current) return;
    subsInitialized.current = true;

    const pref = getSubtitlePref(session.profileId, session.path);
    const files = externalSubsRef.current.map((f) => f.path);
    if (pref?.type === 'external' && !files.some((f) => samePath(f, pref.file))) files.push(pref.file);

    let selectFile: string | null = null;
    if (pref?.type === 'external') selectFile = pref.file;
    else if (!pref && files.length > 0) selectFile = files[0];

    (async () => {
      try {
        for (const file of files) {
          await cmd('add-subtitle', { path: file, select: samePath(file, selectFile) });
        }
      } catch (err) {
        console.warn('[VideoPlayer] add-subtitle error:', err);
      }
    })();
  }, [state.loaded, session.profileId, session.path, cmd]);

  useEffect(() => {
    if (!state.loaded || audioReconciledPath.current === session.path) return;
    const audioTracks = state.tracks.filter((t) => t.type === 'audio');
    if (audioTracks.length === 0) return;

    audioReconciledPath.current = session.path;
    const pref = getAudioPref(session.profileId, session.path);
    const prefTrack = pref != null ? audioTracks.find((t) => t.id === pref) : undefined;
    const defaultTrack = audioTracks.find((t) => t.default) ?? audioTracks[0];
    const targetId = prefTrack?.id ?? defaultTrack.id;
    const correctingPref = pref != null && !prefTrack;

    (async () => {
      try {
        const result = await api.playerCommand('audio-track', targetId);
        if (!result.ok) {
          console.warn('[audio-track]', result.error);
          return;
        }
        if (correctingPref) saveAudioPref(session.profileId, session.path, targetId);
      } catch (err) {
        console.warn('[VideoPlayer] audio-track error:', err);
      }
    })();
  }, [state.loaded, state.tracks, session.path, session.profileId, api]);

  const showFlash = (kind: NonNullable<Flash>['kind']) => setFlash({ kind, key: Date.now() });

  const togglePause = useCallback(() => {
    showFlash(stateRef.current.pause ? 'play' : 'pause');
    cmd('toggle-pause');
  }, [cmd]);

  const skip = useCallback((delta: number) => {
    showFlash(delta < 0 ? 'back' : 'forward');
    cmd('seek', delta);
  }, [cmd]);

  const seekTo = useCallback((time: number) => { cmd('seek-absolute', time); }, [cmd]);

  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const setVolume = useCallback((next: number) => {
    const snapped = snapPlayerVolume(next, volumeRef.current);
    const clamped = clampPlayerVolume(snapped);
    setVolumeState({ volume: clamped, muted: false });
    savePlayerVolume(clamped, false);
    cmd('volume', clamped);
    cmd('mute', false);
  }, [cmd]);

  const toggleMute = useCallback(() => {
    setVolumeState((prev) => {
      const nextMuted = !prev.muted;
      savePlayerVolume(prev.volume, nextMuted);
      cmd('mute', nextMuted);
      return { ...prev, muted: nextMuted };
    });
  }, [cmd]);

  const selectAudio = useCallback(async (id: number) => {
    if (stateRef.current.audioId === id) return;
    const result = await api.playerCommand('audio-track', id);
    if (!result.ok) {
      console.warn('[audio-track]', result.error);
      return;
    }
    saveAudioPref(session.profileId, session.path, id);
  }, [api, session.profileId, session.path]);

  const selectSubtitle = useCallback((id: number | null) => {
    cmd('subtitle-track', id);
    if (id === null) {
      saveSubtitlePref(session.profileId, session.path, { type: 'off' });
      return;
    }
    const track = stateRef.current.tracks.find((t) => t.type === 'sub' && t.id === id);
    if (track?.external && track['external-filename']) {
      saveSubtitlePref(session.profileId, session.path, { type: 'external', file: track['external-filename'] });
    } else {
      saveSubtitlePref(session.profileId, session.path, { type: 'embedded', id });
    }
  }, [cmd, session.profileId, session.path]);

  const updateSubtitleStyle = useCallback(async (style: SubtitleStyle) => {
    setSubtitleStyle(style);
    saveSubtitleStyle(style);
    const result = await api.playerCommand('subtitle-style', subtitleStyleToMpv(style));
    if (!result.ok) console.warn('[subtitle-style]', result.error);
  }, [api]);

  const importSubtitle = useCallback(async () => {
    const file = await api.selectSubtitleFile();
    if (!file) return;
    await cmd('add-subtitle', { path: file, select: true });
    saveSubtitlePref(session.profileId, session.path, { type: 'external', file });
    setOpenPanel(null);
  }, [api, cmd, session.profileId, session.path]);

  const toggleFullscreen = useCallback(() => { api.playerToggleFullscreen(); }, [api]);

  const exitPlayer = useCallback(() => {
    persistProgress();
    const { timePos, duration } = stateRef.current;
    api.playerExit({ path: session.path, position: timePos, duration });
  }, [api, persistProgress, session.path]);

  const playPrev = useCallback(() => {
    if (!session.prev || requestedNext.current) return;
    requestedNext.current = true;
    setTimeout(() => { requestedNext.current = false; }, 3000);
    persistProgress();
    api.playerRequestPrev(session.prev.path);
  }, [api, persistProgress, session.prev]);

  const playNext = useCallback(() => {
    if (!session.next || requestedNext.current) return;
    requestedNext.current = true;
    setTimeout(() => { requestedNext.current = false; }, 3000);
    persistProgress();
    api.playerRequestNext(session.next.path);
  }, [api, persistProgress, session.next]);

  const handleEscape = useCallback(() => {
    if (openPanel) setOpenPanel(null);
    else if (isFullscreen) api.playerSetFullscreen(false);
    else exitPlayer();
  }, [api, openPanel, isFullscreen, exitPlayer]);

  usePlayerKeyboard({
    onTogglePause: togglePause,
    onSeek: skip,
    onVolumeStep: (delta) => setVolume((muted ? 0 : volume) + delta),
    onMute: toggleMute,
    onFullscreen: toggleFullscreen,
    onEscape: handleEscape,
    onSubtitlesToggle: () => setOpenPanel((p) => (p === 'tracks' ? null : 'tracks')),
    onPrev: session.prev ? playPrev : undefined,
    onNext: session.next ? playNext : undefined,
    onActivity: poke,
  });

  // Single click toggles playback; double click toggles full screen
  const handleSurfaceClick = () => {
    if (openPanel) return;
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      togglePause();
    }, 220);
  };

  const handleSurfaceDoubleClick = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    toggleFullscreen();
  };

  const outroWindow = resolveOutroWindowSeconds(session.outroSkipSeconds ?? 0);
  const remaining = state.duration - state.timePos;
  const showNextCard = Boolean(
    session.next && !nextDismissed && state.loaded && state.duration > outroWindow + 30 &&
    remaining <= outroWindow,
  );
  useEffect(() => {
    if (state.eof && session.next && !nextDismissed) playNext();
  }, [state.eof, session.next, nextDismissed, playNext]);

  const audioTracks = state.tracks.filter((t) => t.type === 'audio');
  const subtitleTracks = state.tracks.filter((t) => t.type === 'sub');
  const selectedAudioId =
    state.audioId ?? audioTracks.find((t) => t.selected)?.id ?? null;
  const selectedSubtitleId = subtitleTracks.find((t) => t.selected)?.id ?? null;
  const loading = !error && (!state.loaded || state.buffering);

  return (
    <div
      className={`fixed inset-0 overflow-hidden select-none ${controlsVisible ? '' : 'cursor-none'}`}
      onMouseMove={poke}
      onMouseLeave={() => { if (!keepVisible) hide(); }}
    >
      {/* Near-invisible hit surface so the transparent window receives mouse input */}
      <div
        className="absolute inset-0 bg-black/[0.01]"
        onClick={handleSurfaceClick}
        onDoubleClick={handleSurfaceDoubleClick}
      />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full border-4 border-white/15 border-t-accent animate-spin" />
        </div>
      )}

      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.key}
            initial={{ opacity: 0.9, scale: 0.8 }}
            animate={{ opacity: 0, scale: 1.3 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            onAnimationComplete={() => setFlash((f) => (f?.key === flash.key ? null : f))}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="w-24 h-24 rounded-full bg-black/50 flex items-center justify-center">
              {flash.kind === 'play' && <Play className="w-12 h-12 fill-white text-white ml-1" />}
              {flash.kind === 'pause' && <Pause className="w-12 h-12 fill-white text-white" />}
              {flash.kind === 'back' && <RotateCcw className="w-12 h-12 text-white" />}
              {flash.kind === 'forward' && <RotateCw className="w-12 h-12 text-white" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!error && (
        <PlayerControls
          title={session.title}
          subtitle={session.subtitle}
          state={state}
          volume={volume}
          muted={muted}
          visible={controlsVisible}
          isFullscreen={isFullscreen}
          openPanel={openPanel}
          audioTracks={audioTracks}
          subtitleTracks={subtitleTracks}
          selectedAudioId={selectedAudioId}
          selectedSubtitleId={selectedSubtitleId}
          hasPrev={Boolean(session.prev)}
          hasNext={Boolean(session.next)}
          onPanelChange={setOpenPanel}
          onBack={exitPlayer}
          onTogglePause={togglePause}
          onSeek={seekTo}
          onSkip={skip}
          onVolumeChange={setVolume}
          onMute={toggleMute}
          onSpeedChange={(s) => cmd('speed', s)}
          onSelectAudio={selectAudio}
          onSelectSubtitle={selectSubtitle}
          onImportSubtitle={importSubtitle}
          subtitleStyle={subtitleStyle}
          onSubtitleStyleChange={updateSubtitleStyle}
          onFullscreen={toggleFullscreen}
          onPrev={session.prev ? playPrev : undefined}
          onNext={session.next ? playNext : undefined}
          onScrubbingChange={setScrubbing}
        />
      )}

      <AnimatePresence>
        {showNextCard && session.next && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`absolute right-6 md:right-10 flex items-center gap-3 transition-[bottom] duration-300 ${controlsVisible ? 'bottom-36' : 'bottom-12'}`}
          >
            <button
              onClick={() => setNextDismissed(true)}
              className="px-6 py-3 rounded bg-black/60 border border-white/40 text-white font-bold hover:bg-black/80 transition"
            >
              Watch Credits
            </button>
            <button
              onClick={playNext}
              className="relative overflow-hidden px-6 py-3 rounded bg-white/40 text-black font-bold flex items-center gap-2"
            >
              <span
                className="absolute inset-y-0 left-0 bg-white transition-[width] duration-300 ease-linear"
                style={{ width: `${Math.min(100, Math.max(0, ((outroWindow - remaining) / outroWindow) * 100))}%` }}
              />
              <Play className="relative w-5 h-5 fill-black" />
              <span className="relative">Next Episode</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85">
          <div className="max-w-md text-center px-8">
            <p className="text-white text-2xl font-bold mb-3">Playback error</p>
            <p className="text-white/60 mb-8">{error}</p>
            <button
              onClick={exitPlayer}
              className="inline-flex items-center gap-2 bg-white text-black px-7 py-3 rounded font-bold hover:bg-white/80 transition"
            >
              <ArrowLeft className="w-5 h-5" /> Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
