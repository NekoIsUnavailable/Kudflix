import type { LocalFile } from '../components/NetflixUI';
import { getPlayerDisplayTitle, getLibraryDisplayTitle } from './displayTitle';
import { deleteWatchHistoryThumb, setWatchHistoryThumb } from './thumbnailCache';

const MAX_ENTRIES = 500;

export interface WatchHistoryEntry {
  id: string;
  path: string;
  watchedAt: string;
  position: number;
  duration: number;
  percent: number;
  completed: boolean;
  mediaType: 'movie' | 'episode';
  title: string;
  subtitle?: string;
  seriesTitle?: string;
  year?: string;
  genre?: string;
  thumbnailKey?: string;
}

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function storageKey(profileId: string): string {
  return `netflix_watch_history_${profileId}`;
}

function readList(profileId: string): WatchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(profileId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WatchHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(profileId: string, entries: WatchHistoryEntry[]): void {
  localStorage.setItem(storageKey(profileId), JSON.stringify(entries));
  snapshotCache.set(profileId, entries);
  listeners.get(profileId)?.forEach((fn) => fn());
}

const snapshotCache = new Map<string, WatchHistoryEntry[]>();

export function getWatchHistorySnapshot(profileId: string | null): WatchHistoryEntry[] {
  if (!profileId) return [];
  const cached = snapshotCache.get(profileId);
  if (cached) return cached;
  const list = readList(profileId);
  snapshotCache.set(profileId, list);
  return list;
}

export function subscribeWatchHistory(profileId: string | null, onChange: () => void): () => void {
  if (!profileId) return () => {};
  if (!listeners.has(profileId)) listeners.set(profileId, new Set());
  listeners.get(profileId)!.add(onChange);
  return () => listeners.get(profileId)?.delete(onChange);
}

export function episodeCodeFromFile(video: LocalFile): string | undefined {
  const m = video.name.match(/s(\d+)e(\d+)/i);
  return m ? `S${parseInt(m[1], 10)}:E${parseInt(m[2], 10)}` : undefined;
}

function isMeaningfulWatch(position: number, duration: number): boolean {
  if (position >= 60) return true;
  if (duration > 0 && position / duration >= 0.05) return true;
  return false;
}

function pickThumbnail(video: LocalFile): string | null {
  const t = video.thumbnail || video.meta?.poster;
  if (!t) return null;
  if (t.startsWith('data:') || t.startsWith('http') || t.startsWith('file:') || t.startsWith('./')) {
    return t;
  }
  return t;
}

function buildEntryFields(
  video: LocalFile,
  position: number,
  duration: number,
  watchedAt: string,
  episodeCode?: string,
): WatchHistoryEntry {
  const isEpisode = video.category === 'tv' && !video.isFolder;
  const mediaType = isEpisode ? 'episode' : 'movie';
  const seriesTitle = isEpisode ? getPlayerDisplayTitle(video) : undefined;
  const episodeTitle = isEpisode ? getLibraryDisplayTitle(video) : undefined;
  const title = isEpisode ? seriesTitle || episodeTitle || video.name : getPlayerDisplayTitle(video);

  let subtitle: string | undefined;
  if (isEpisode) {
    const code = episodeCode ?? episodeCodeFromFile(video);
    const parts = [code, episodeTitle !== seriesTitle ? episodeTitle : undefined].filter(Boolean);
    subtitle = parts.length > 0 ? parts.join(' · ') : undefined;
  }

  const dur = duration > 0 ? duration : video.duration ?? 0;
  const pos = Math.max(0, position);
  const percent = dur > 0 ? Math.min(1, pos / dur) : 0;
  const completed = dur > 0 ? pos / dur >= 0.9 : pos === 0;

  return {
    id: crypto.randomUUID(),
    path: video.path,
    watchedAt,
    position: pos,
    duration: dur,
    percent,
    completed,
    mediaType,
    title,
    subtitle,
    seriesTitle,
    year: video.meta?.year,
    genre: video.meta?.genre,
  };
}

async function attachThumb(entry: WatchHistoryEntry, video: LocalFile): Promise<WatchHistoryEntry> {
  const thumb = pickThumbnail(video);
  if (thumb?.startsWith('data:')) {
    await setWatchHistoryThumb(entry.id, thumb);
    return { ...entry, thumbnailKey: entry.id };
  }
  return entry;
}

async function pushEntries(profileId: string, entries: WatchHistoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const list = readList(profileId);
  for (const entry of entries) {
    list.unshift(entry);
  }
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  writeList(profileId, list);
}

export async function appendWatchHistory(
  profileId: string,
  video: LocalFile,
  payload: { path: string; position: number; duration: number },
  episodeCode?: string,
): Promise<void> {
  const duration = payload.duration > 0 ? payload.duration : video.duration ?? 0;
  const position = Math.max(0, payload.position);
  if (!isMeaningfulWatch(position, duration)) return;

  let entry = buildEntryFields(video, position, duration, new Date().toISOString(), episodeCode);
  entry = await attachThumb(entry, video);
  await pushEntries(profileId, [entry]);
}

/** Manual / import / mark-watched, skips the “meaningful watch” gate. */
export async function appendWatchHistoryManual(
  profileId: string,
  video: LocalFile,
  options: {
    position: number;
    duration: number;
    completed?: boolean;
    watchedAt?: string;
    episodeCode?: string;
  },
): Promise<void> {
  const watchedAt = options.watchedAt ?? new Date().toISOString();
  let entry = buildEntryFields(
    video,
    options.position,
    options.duration,
    watchedAt,
    options.episodeCode,
  );
  if (options.completed !== undefined) {
    entry = { ...entry, completed: options.completed };
  }
  entry = await attachThumb(entry, video);
  await pushEntries(profileId, [entry]);
}

export async function appendWatchHistoryBulk(
  profileId: string,
  items: {
    video: LocalFile;
    position: number;
    duration: number;
    completed: boolean;
    watchedAt?: string;
  }[],
): Promise<number> {
  const watchedAt = new Date().toISOString();
  const entries: WatchHistoryEntry[] = [];
  for (const item of items) {
    let entry = buildEntryFields(
      item.video,
      item.position,
      item.duration,
      item.watchedAt ?? watchedAt,
    );
    entry = { ...entry, completed: item.completed };
    entry = await attachThumb(entry, item.video);
    entries.push(entry);
  }
  await pushEntries(profileId, entries);
  return entries.length;
}

export async function recordWatchHistoryFromMark(
  profileId: string,
  videos: LocalFile[],
  progresses: Record<string, number>,
): Promise<void> {
  const items = videos.filter((v) => !v.isFolder).map((video) => {
    const dur = video.duration ?? 0;
    const pos = progresses[video.path] ?? 0;
    let position = pos;
    let duration = dur;
    let completed = true;

    if (pos > 0 && dur > 0) {
      completed = pos / dur >= 0.9;
    } else if (pos > 0) {
      duration = Math.max(pos, 1);
      completed = false;
    } else if (dur > 0) {
      position = dur * 0.95;
      completed = true;
    }

    return { video, position, duration, completed };
  });

  await appendWatchHistoryBulk(profileId, items);
}

export function updateWatchHistoryWatchedAt(
  profileId: string,
  entryId: string,
  watchedAtIso: string,
): boolean {
  const list = readList(profileId);
  const idx = list.findIndex((e) => e.id === entryId);
  if (idx < 0) return false;
  const parsed = new Date(watchedAtIso);
  if (Number.isNaN(parsed.getTime())) return false;
  list[idx] = { ...list[idx], watchedAt: parsed.toISOString() };
  writeList(profileId, list);
  return true;
}

export async function removeWatchHistoryEntry(profileId: string, entryId: string): Promise<boolean> {
  const list = readList(profileId);
  const idx = list.findIndex((e) => e.id === entryId);
  if (idx < 0) return false;
  const [removed] = list.splice(idx, 1);
  if (removed?.thumbnailKey) await deleteWatchHistoryThumb(removed.thumbnailKey);
  writeList(profileId, list);
  return true;
}

export async function clearWatchHistory(profileId: string): Promise<void> {
  const list = readList(profileId);
  for (const entry of list) {
    if (entry.thumbnailKey) await deleteWatchHistoryThumb(entry.thumbnailKey);
  }
  localStorage.removeItem(storageKey(profileId));
  snapshotCache.delete(profileId);
  listeners.get(profileId)?.forEach((fn) => fn());
}
