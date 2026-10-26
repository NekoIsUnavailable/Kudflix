import type { LocalFile } from '../components/NetflixUI';

export interface MediaOverride {
  title?: string;
  description?: string;
  genre?: string;
  year?: string;
  tmdbId?: string;
  anilistId?: string;
  provider?: 'tmdb' | 'anilist';
  disableTmdb?: boolean;
  useSeriesThumbnailForEpisodes?: boolean;
  /** Next-episode UI appears this many seconds before end. */
  outroSkipSeconds?: number;
}

const STORAGE_KEY = 'netflix_media_overrides';

function loadAll(): Record<string, MediaOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getMediaOverride(path: string): MediaOverride | undefined {
  return loadAll()[path];
}

export function saveMediaOverride(path: string, override: MediaOverride): void {
  const all = loadAll();
  const merged = { ...all[path], ...override };
  if ('tmdbId' in override) {
    if (override.tmdbId) merged.tmdbId = override.tmdbId;
    else delete merged.tmdbId;
  }
  if ('anilistId' in override) {
    if (override.anilistId) merged.anilistId = override.anilistId;
    else delete merged.anilistId;
  }
  delete (merged as Record<string, unknown>).introSkipSeconds;
  if ('outroSkipSeconds' in override) {
    if (override.outroSkipSeconds != null && override.outroSkipSeconds > 0) {
      merged.outroSkipSeconds = override.outroSkipSeconds;
    } else {
      delete merged.outroSkipSeconds;
    }
  }
  all[path] = merged;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function clearMediaOverride(path: string): void {
  const all = loadAll();
  if (!(path in all)) return;
  delete all[path];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function isTmdbDisabled(video: Pick<LocalFile, 'path'> | null | undefined): boolean {
  if (!video) return false;
  return getMediaOverride(video.path)?.disableTmdb === true;
}

export function applyMediaOverride(file: LocalFile): LocalFile {
  const override = getMediaOverride(file.path);
  if (!override) return file;

  return {
    ...file,
    tmdbDisabled: override.disableTmdb === true,
    meta: {
      ...file.meta,
      title: override.title ?? file.meta?.title,
      description: override.description ?? file.meta?.description,
      genre: override.genre ?? file.meta?.genre,
      year: override.year ?? file.meta?.year,
    },
  };
}

export function mergeOverrideIntoMeta(
  meta: { title: string; description: string; poster: string | null; year: string; genre: string },
  path: string,
) {
  const override = getMediaOverride(path);
  if (!override) return meta;

  return {
    ...meta,
    title: override.title ?? meta.title,
    description: override.description ?? meta.description,
    genre: override.genre ?? meta.genre,
    year: override.year ?? meta.year,
  };
}
