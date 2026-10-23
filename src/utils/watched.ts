import type { LocalFile } from '../components/NetflixUI';

const WATCHED_THRESHOLD = 0.9;

function storageKey(profileId: string): string {
  return `netflix_watched_manual_${profileId}`;
}

function loadManual(profileId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(storageKey(profileId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getManualWatched(profileId: string, path: string): boolean | undefined {
  const manual = loadManual(profileId);
  return path in manual ? manual[path] : undefined;
}

/** True only when the user explicitly marked the item watched (not auto-detected from progress). */
export function isManuallyMarkedWatched(
  profileId: string | null | undefined,
  path: string,
): boolean {
  if (!profileId) return false;
  return getManualWatched(profileId, path) === true;
}

export function setManualWatched(profileId: string, path: string, value: boolean | null): void {
  const manual = loadManual(profileId);
  if (value === null) {
    delete manual[path];
  } else {
    manual[path] = value;
  }
  localStorage.setItem(storageKey(profileId), JSON.stringify(manual));
}

export function isAutoWatched(
  path: string,
  duration: number | undefined,
  progresses: Record<string, number>,
): boolean {
  if (!duration || duration <= 0) return false;
  const pos = progresses[path];
  if (pos == null || pos <= 0) return false;
  return pos / duration >= WATCHED_THRESHOLD;
}

export function isWatched(
  item: Pick<LocalFile, 'path' | 'duration'>,
  progresses: Record<string, number>,
  profileId: string | null | undefined,
): boolean {
  if (!profileId) return isAutoWatched(item.path, item.duration, progresses);

  const manual = getManualWatched(profileId, item.path);
  if (manual === false) return false;
  if (manual === true) return true;
  return isAutoWatched(item.path, item.duration, progresses);
}

export function isSeriesWatched(
  folder: LocalFile,
  progresses: Record<string, number>,
  profileId: string | null | undefined,
): boolean {
  if (!profileId) return false;

  const manual = getManualWatched(profileId, folder.path);
  if (manual === false) return false;
  if (manual === true) return true;

  const episodes = folder.folderFiles ?? [];
  if (episodes.length === 0) return false;

  const withDuration = episodes.filter((ep) => ep.duration && ep.duration > 0);
  if (withDuration.length === 0) return false;

  return withDuration.every((ep) => isWatched(ep, progresses, profileId));
}

export function hasUnwatchedEpisode(
  folder: LocalFile,
  progresses: Record<string, number>,
  profileId: string | null | undefined,
): boolean {
  return !isSeriesWatched(folder, progresses, profileId);
}

export type GridWatchedFilter = 'all' | 'unwatched' | 'watched';

/** Watched/unwatched filter for grid modals (movies, series folders, or mixed rows). */
export function matchesGridWatchedFilter(
  video: LocalFile,
  filter: GridWatchedFilter,
  progresses: Record<string, number>,
  profileId: string,
  mediaType?: 'movie' | 'tv',
): boolean {
  if (filter === 'all') return true;

  const asTv = mediaType === 'tv' || (mediaType !== 'movie' && video.isFolder);
  if (asTv && video.isFolder) {
    if (filter === 'watched') return isSeriesWatched(video, progresses, profileId);
    return hasUnwatchedEpisode(video, progresses, profileId);
  }

  const w = isWatched(video, progresses, profileId);
  return filter === 'watched' ? w : !w;
}

export function hasPartialProgress(
  path: string,
  duration: number | undefined,
  progresses: Record<string, number>,
): boolean {
  if (!duration || duration <= 0) return false;
  const pos = progresses[path];
  if (pos == null || pos <= 0) return false;
  return pos / duration < WATCHED_THRESHOLD;
}

export function isPartiallyWatched(
  item: LocalFile,
  progresses: Record<string, number>,
  profileId: string | null | undefined,
): boolean {
  if (!profileId) return false;

  if (item.isFolder) {
    if (isSeriesWatched(item, progresses, profileId)) return false;
    const episodes = item.folderFiles ?? [];
    if (episodes.length === 0) return false;

    const withDuration = episodes.filter((ep) => ep.duration && ep.duration > 0);
    const pool = withDuration.length > 0 ? withDuration : episodes;

    const hasWatchedEp = pool.some((ep) => isWatched(ep, progresses, profileId));
    const hasUnwatchedEp = pool.some((ep) => !isWatched(ep, progresses, profileId));
    return hasWatchedEp && hasUnwatchedEp;
  }

  if (isWatched(item, progresses, profileId)) return false;
  return hasPartialProgress(item.path, item.duration, progresses);
}

export function isSeasonWatched(
  episodes: LocalFile[],
  progresses: Record<string, number>,
  profileId: string | null | undefined,
): boolean {
  if (!profileId || episodes.length === 0) return false;

  const withDuration = episodes.filter((ep) => ep.duration && ep.duration > 0);
  const pool = withDuration.length > 0 ? withDuration : episodes;

  return pool.every((ep) => isWatched(ep, progresses, profileId));
}

export function setEpisodesWatched(
  profileId: string,
  episodes: LocalFile[],
  watched: boolean | null,
): void {
  for (const ep of episodes) {
    setManualWatched(profileId, ep.path, watched);
  }
}

export function setSeriesWatched(
  profileId: string,
  folder: LocalFile,
  watched: boolean | null,
): void {
  setManualWatched(profileId, folder.path, watched);
  if (folder.folderFiles) {
    setEpisodesWatched(profileId, folder.folderFiles, watched);
  }
}

export function pruneWatchedManual(profileId: string, removedPaths: Set<string>): void {
  if (removedPaths.size === 0) return;
  const manual = loadManual(profileId);
  let changed = false;
  for (const path of removedPaths) {
    if (path in manual) {
      delete manual[path];
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(storageKey(profileId), JSON.stringify(manual));
  }
}
