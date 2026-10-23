export type SubtitlePref =
  | { type: 'off' }
  | { type: 'embedded'; id: number }
  | { type: 'external'; file: string };

export type SubtitleStyle = {
  size: 'small' | 'default' | 'large';
  color: 'white' | 'yellow';
  opacity: '100' | '75' | '50';
  background: 'none' | 'outline' | 'box';
  position: 'default' | 'low' | 'high';
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  size: 'default',
  color: 'white',
  opacity: '100',
  background: 'none',
  position: 'default',
};

const SUB_PREFS_KEY = 'kudflix_sub_prefs';
const SUB_STYLE_KEY = 'kudflix_subtitle_style';
const AUDIO_PREFS_KEY = 'kudflix_audio_prefs';
const VOLUME_KEY = 'kudflix_player_volume';
const MUTE_KEY = 'kudflix_player_muted';
const VOLUME_BOOST_SESSION_KEY = 'kudflix_player_volume_boost_session';

/** mpv volume above 100% requires --volume-max; UI shows a separate boost segment. */
export const PLAYER_VOLUME_REFERENCE = 100;
export const PLAYER_VOLUME_MAX = 150;

export function clampPlayerVolume(value: number): number {
  return Math.max(0, Math.min(PLAYER_VOLUME_MAX, Math.round(value)));
}

/** Snap range around 100% — wider band so the slider catches firmly at reference volume. */
export const PLAYER_VOLUME_SNAP_RADIUS = 6;

export function snapPlayerVolume(raw: number, prev: number): number {
  const v = clampPlayerVolume(raw);
  const ref = PLAYER_VOLUME_REFERENCE;
  const r = PLAYER_VOLUME_SNAP_RADIUS;
  const lo = ref - r;
  const hi = ref + r;
  const inDetent = v >= lo && v <= hi;

  if (v === ref) return ref;

  const enteringFromBelow = prev < lo && v >= lo;
  const enteringFromAbove = prev > hi && v <= hi;
  if (enteringFromBelow || enteringFromAbove) return ref;

  if (prev > ref && inDetent) return ref;
  if (prev < ref && inDetent) return ref;
  if (prev < ref && v > ref && v <= hi + 1) return ref;

  // Sticky detent while scrubbing inside the band (but allow nudging up from exactly 100 into boost).
  if (inDetent && prev >= lo && prev <= hi && !(prev === ref && v > ref)) return ref;

  if (prev <= ref && v > hi) return v;

  return v;
}

function readBoostSessionFlag(): boolean {
  return localStorage.getItem(VOLUME_BOOST_SESSION_KEY) === '1';
}

function setBoostSessionFlag(active: boolean) {
  if (active) localStorage.setItem(VOLUME_BOOST_SESSION_KEY, '1');
  else localStorage.removeItem(VOLUME_BOOST_SESSION_KEY);
}

/** Volume for a newly opened title (boost from the prior title does not carry over). */
export function loadPlayerVolumeForNewSession(): { volume: number; muted: boolean } {
  const { volume, muted } = loadPlayerVolume();
  if (readBoostSessionFlag()) {
    setBoostSessionFlag(false);
    const reset = PLAYER_VOLUME_REFERENCE;
    savePlayerVolume(reset, muted);
    return { volume: reset, muted };
  }
  return { volume, muted };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getSubtitlePref(profileId: string, videoPath: string): SubtitlePref | null {
  const prefs = readJson<Record<string, SubtitlePref>>(`${SUB_PREFS_KEY}_${profileId}`, {});
  const pref = prefs[videoPath];
  return pref && typeof pref === 'object' && 'type' in pref ? pref : null;
}

function normalizeSubtitleSize(size: unknown, version: number): SubtitleStyle['size'] {
  if (version >= 2) {
    if (size === 'small' || size === 'default' || size === 'large') return size;
    return DEFAULT_SUBTITLE_STYLE.size;
  }
  // Legacy presets: old "small"/"medium" both map to the new "default" size
  if (size === 'large') return 'large';
  return 'default';
}

function subtitleColorWithOpacity(color: SubtitleStyle['color'], opacity: SubtitleStyle['opacity']) {
  const alpha = opacity === '50' ? '80' : opacity === '75' ? 'BF' : 'FF';
  const rgb = color === 'yellow' ? 'FFFF00' : 'FFFFFF';
  return `#${alpha}${rgb}`;
}

export function loadSubtitleStyle(): SubtitleStyle {
  const raw = readJson<Record<string, unknown>>(SUB_STYLE_KEY, {});
  const version = typeof raw.v === 'number' ? raw.v : 1;
  const opacity = raw.opacity === '75' || raw.opacity === '50' ? raw.opacity : DEFAULT_SUBTITLE_STYLE.opacity;
  return {
    size: normalizeSubtitleSize(raw.size, version),
    color: raw.color === 'yellow' ? 'yellow' : DEFAULT_SUBTITLE_STYLE.color,
    opacity,
    background: raw.background === 'outline' || raw.background === 'box' ? raw.background : DEFAULT_SUBTITLE_STYLE.background,
    position: raw.position === 'low' || raw.position === 'high' ? raw.position : DEFAULT_SUBTITLE_STYLE.position,
  };
}

export function saveSubtitleStyle(style: SubtitleStyle) {
  localStorage.setItem(SUB_STYLE_KEY, JSON.stringify({ ...style, v: 2 }));
}

/** mpv property values for a subtitle style preset (colors use #AARRGGBB) */
export function subtitleStyleToMpv(style: SubtitleStyle) {
  const scale = style.size === 'small' ? 0.68 : style.size === 'large' ? 1.12 : 0.82;
  const fontSize = style.size === 'small' ? 28 : style.size === 'large' ? 44 : 36;
  const color = subtitleColorWithOpacity(style.color, style.opacity);
  const marginY = style.position === 'low' ? 24 : style.position === 'high' ? 80 : 48;
  const borderSize = style.background === 'outline' ? 4 : style.background === 'box' ? 1 : 2.5;
  const boxAlpha = style.opacity === '50' ? '60' : style.opacity === '75' ? '90' : 'C0';
  const backColor = style.background === 'box' ? `#${boxAlpha}000000` : '#00000000';
  const shadowOffset = style.background === 'outline' ? 2 : 1.5;
  return { scale, fontSize, color, marginY, borderSize, backColor, shadowOffset };
}

export function saveSubtitlePref(profileId: string, videoPath: string, pref: SubtitlePref) {
  const key = `${SUB_PREFS_KEY}_${profileId}`;
  const prefs = readJson<Record<string, SubtitlePref>>(key, {});
  prefs[videoPath] = pref;
  localStorage.setItem(key, JSON.stringify(prefs));
}

export function getAudioPref(profileId: string, videoPath: string): number | null {
  const prefs = readJson<Record<string, number>>(`${AUDIO_PREFS_KEY}_${profileId}`, {});
  return typeof prefs[videoPath] === 'number' ? prefs[videoPath] : null;
}

export function saveAudioPref(profileId: string, videoPath: string, trackId: number) {
  const key = `${AUDIO_PREFS_KEY}_${profileId}`;
  const prefs = readJson<Record<string, number>>(key, {});
  prefs[videoPath] = trackId;
  localStorage.setItem(key, JSON.stringify(prefs));
}

export function loadPlayerVolume(): { volume: number; muted: boolean } {
  const volume = Number(localStorage.getItem(VOLUME_KEY));
  return {
    volume:
      Number.isFinite(volume) && localStorage.getItem(VOLUME_KEY) !== null
        ? clampPlayerVolume(volume)
        : PLAYER_VOLUME_REFERENCE,
    muted: localStorage.getItem(MUTE_KEY) === '1',
  };
}

export function savePlayerVolume(volume: number, muted: boolean) {
  const v = clampPlayerVolume(volume);
  if (v > PLAYER_VOLUME_REFERENCE) {
    setBoostSessionFlag(true);
  } else {
    setBoostSessionFlag(false);
    localStorage.setItem(VOLUME_KEY, String(v));
  }
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

export function saveProgress(profileId: string, videoPath: string, position: number) {
  const key = `netflix_progress_${profileId}`;
  const progress = readJson<Record<string, number>>(key, {});
  progress[videoPath] = position;
  localStorage.setItem(key, JSON.stringify(progress));
}

export function samePath(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', eng: 'English', english: 'English',
  ja: 'Japanese', jpn: 'Japanese', jp: 'Japanese',
  es: 'Spanish', spa: 'Spanish', fr: 'French', fre: 'French', fra: 'French',
  de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian',
  pt: 'Portuguese', por: 'Portuguese', ru: 'Russian', rus: 'Russian',
  zh: 'Chinese', chi: 'Chinese', zho: 'Chinese', ko: 'Korean', kor: 'Korean',
  ar: 'Arabic', ara: 'Arabic', nl: 'Dutch', dut: 'Dutch', nld: 'Dutch',
  pl: 'Polish', pol: 'Polish', sv: 'Swedish', swe: 'Swedish', tr: 'Turkish', tur: 'Turkish',
  hi: 'Hindi', hin: 'Hindi',
};

export function languageName(code?: string) {
  if (!code) return '';
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

const CODEC_NAMES: Record<string, string> = {
  ac3: 'Dolby Digital', eac3: 'Dolby Digital Plus', truehd: 'Dolby TrueHD',
  dts: 'DTS', 'dts-hd': 'DTS-HD', dca: 'DTS', aac: 'AAC', mp3: 'MP3',
  opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC',
  subrip: 'SRT', ass: 'ASS', ssa: 'SSA', webvtt: 'VTT',
  hdmv_pgs_subtitle: 'PGS', dvd_subtitle: 'VobSub', mov_text: 'Text',
};

function channelLabel(channels?: number) {
  if (!channels) return '';
  if (channels >= 8) return '7.1';
  if (channels >= 6) return '5.1';
  if (channels === 2) return 'Stereo';
  if (channels === 1) return 'Mono';
  return `${channels}ch`;
}

function fileName(p?: string) {
  return p ? p.split(/[/\\]/).pop() ?? p : '';
}

export function audioTrackLabel(t: MpvTrack) {
  const lang = languageName(t.lang);
  const codec = t.codec ? CODEC_NAMES[t.codec] ?? t.codec.toUpperCase() : '';
  const channels = channelLabel(t['demux-channel-count'] ?? t['audio-channels']);
  const main = lang || t.title || `Track ${t.id}`;
  const detail = [codec, channels].filter(Boolean).join(' ');
  const extra = lang && t.title && !t.title.toLowerCase().includes(lang.toLowerCase()) ? t.title : '';
  return { main, detail: [extra, detail].filter(Boolean).join(' · ') };
}

export function subtitleTrackLabel(t: MpvTrack) {
  const lang = languageName(t.lang);
  const main = lang || t.title || (t.external ? fileName(t['external-filename']) : `Subtitle ${t.id}`);
  const extra = lang && t.title ? t.title : '';
  const source = t.external ? 'File' : (t.codec ? CODEC_NAMES[t.codec] ?? t.codec.toUpperCase() : '');
  return { main, detail: [extra, source].filter(Boolean).join(' · ') };
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Compact duration for info panels, e.g. 2h30m */
export function formatDurationShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
