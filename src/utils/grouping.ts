import type { LocalFile } from '../components/NetflixUI';
import { applyMediaOverride, isTmdbDisabled } from './mediaOverrides';
import { getSeasonGroupKey, resolveEpisodeNumbers, isSeasonFolderName } from './episodeParsing';
import { parseSeriesFolderName } from './metadata';
import { getCachedForVideo } from './tmdb';

function normPath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

function normFolderPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function pathBasename(p: string): string {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(i + 1) : n;
}

let parentFolderPaths: string[] = [];
let parentFolderBasenames = new Set<string>();

/** Mark TV library folders whose children (not the folder itself) are series. */
export function setTvParentFolders(paths: string[] | undefined): void {
  parentFolderPaths = (paths ?? []).map(normFolderPath).filter(Boolean);
  parentFolderBasenames = new Set(parentFolderPaths.map((p) => pathBasename(p).toLowerCase()));
}

function isParentFolderName(name: string): boolean {
  return parentFolderBasenames.has(name.toLowerCase());
}

function isUnderMarkedParentPath(filePath?: string): boolean {
  if (!filePath || parentFolderPaths.length === 0) return false;
  const n = normFolderPath(filePath);
  return parentFolderPaths.some((parent) => n === parent || n.startsWith(`${parent}/`));
}

function lastNonSeasonIndex(dirs: string[]): number {
  let i = dirs.length - 1;
  while (i >= 0 && isSeasonFolderName(dirs[i])) i -= 1;
  return i;
}

/** Skip marked parent folders so the show is the child directory. */
function skipParentFolders(dirs: string[], startIndex: number): number | null {
  let i = startIndex;
  if (i < 0) return null;
  while (i < dirs.length && isParentFolderName(dirs[i])) {
    const next = i + 1;
    if (next < dirs.length && !isSeasonFolderName(dirs[next])) {
      i = next;
      continue;
    }
    return null;
  }
  return i;
}

function seriesRootFromDirSegments(dirs: string[]): string | null {
  const idx = skipParentFolders(dirs, lastNonSeasonIndex(dirs));
  if (idx == null || idx < 0) return null;
  return dirs[idx] ?? null;
}

const JUNK_GENRES = new Set(['Local Media', 'Movie', 'Series', '']);

export function getSeriesRoot(relativePath?: string): string | null {
  if (!relativePath) return null;
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const dirs = parts.length === 1 ? parts : parts.slice(0, -1);
  if (dirs.length === 0) return parts[0];
  return seriesRootFromDirSegments(dirs);
}

export function getSeriesRootFromFile(f: Pick<LocalFile, 'path' | 'relativePath' | 'folderName'>): string | null {
  if (f.relativePath) {
    const fromRel = getSeriesRoot(f.relativePath);
    if (fromRel) return fromRel;
  }

  if (f.path) {
    const segs = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (segs.length >= 2) {
      const dirs = segs.slice(0, -1);
      const fromPath = seriesRootFromDirSegments(dirs);
      if (fromPath && !(isParentFolderName(fromPath) && isUnderMarkedParentPath(f.path))) {
        return fromPath;
      }
    }
  }

  if (f.folderName && !isSeasonFolderName(f.folderName) && !isParentFolderName(f.folderName)) {
    return f.folderName;
  }

  return null;
}

function childShowUnderRoot(relativePath: string | undefined, root: string): string | null {
  if (!relativePath) return null;
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === root.toLowerCase());
  if (idx < 0 || idx >= parts.length - 2) return null;
  const next = parts[idx + 1];
  if (!next || isSeasonFolderName(next)) return null;
  return next;
}

/** If a "show" folder actually contains multiple series dirs, split by those children. */
function splitContainerGroups(rootFolders: Map<string, LocalFile[]>): Map<string, LocalFile[]> {
  const next = new Map<string, LocalFile[]>();

  for (const [root, list] of rootFolders) {
    const childCounts = new Map<string, number>();
    for (const f of list) {
      const child = childShowUnderRoot(f.relativePath, root);
      if (child) childCounts.set(child, (childCounts.get(child) ?? 0) + 1);
    }
    const childShows = [...childCounts.keys()];
    if (childShows.length < 2) {
      next.set(root, [...(next.get(root) ?? []), ...list]);
      continue;
    }

    for (const f of list) {
      const child = childShowUnderRoot(f.relativePath, root);
      const key = child ?? root;
      if (!next.has(key)) next.set(key, []);
      next.get(key)!.push(f);
    }
  }

  return next;
}

function bestThumbnail(episodes: LocalFile[]): string | undefined {
  for (const ep of episodes) {
    if (ep.localFanart) return ep.localFanart;
  }
  for (const ep of episodes) {
    if (ep.localPoster) return ep.localPoster;
  }
  for (const ep of episodes) {
    if (ep.thumbnail) return ep.thumbnail;
  }
  return undefined;
}

export function buildSeriesFolders(shows: LocalFile[]): LocalFile[] {
  const rootFolders = new Map<string, LocalFile[]>();

  shows.forEach((f) => {
    const root = getSeriesRootFromFile(f) || getSeriesRoot(f.relativePath);
    if (!root) return;
    if (!rootFolders.has(root)) rootFolders.set(root, []);
    rootFolders.get(root)!.push(f);
  });

  const grouped = splitContainerGroups(rootFolders);

  return Array.from(grouped.entries()).map(([root, fList]) => {
    const sorted = [...fList].sort((a, b) => {
      const epA = resolveEpisodeNumbers(a.name, a.relativePath);
      const epB = resolveEpisodeNumbers(b.name, b.relativePath);
      if (epA && epB) {
        if (epA.season !== epB.season) return epA.season - epB.season;
        if (epA.episode !== epB.episode) return epA.episode - epB.episode;
      } else if (epA && !epB) {
        return -1;
      } else if (!epA && epB) {
        return 1;
      }
      const relA = a.relativePath || a.name;
      const relB = b.relativePath || b.name;
      return relA.localeCompare(relB, undefined, { numeric: true, sensitivity: 'base' });
    });
    const fanart = sorted.find((ep) => ep.localFanart)?.localFanart ?? null;
    const poster = sorted.find((ep) => ep.localPoster)?.localPoster ?? null;
    const { title: seriesTitle, year: seriesYear } = parseSeriesFolderName(root);
    const hasAnime = sorted.some((ep) => ep.category === 'anime');
    const folder: LocalFile = {
      name: root,
      path: `folder://${root}`,
      isFolder: true,
      category: hasAnime ? 'anime' : 'tv',
      folderFiles: sorted,
      thumbnail: bestThumbnail(sorted),
      localFanart: fanart,
      localPoster: poster,
      meta: {
        title: seriesTitle,
        year: seriesYear,
        description: `A collection of ${sorted.length} video files inside the ${root} folder.`,
      },
      dateModified: Date.now(),
    };
    return applyMediaOverride(folder);
  });
}

export function isInProgress(file: LocalFile, progresses: Record<string, number>): boolean {
  const pos = progresses[file.path];
  if (!pos || pos <= 5) return false;
  if (file.duration && pos >= file.duration - 30) return false;
  return true;
}

export function buildContinueWatchingMovies(
  movies: LocalFile[],
  progresses: Record<string, number>,
): LocalFile[] {
  return movies.filter((f) => isInProgress(f, progresses));
}

export function buildContinueWatchingSeries(
  shows: LocalFile[],
  progresses: Record<string, number>,
  seriesFolders: LocalFile[],
): LocalFile[] {
  const inProgress = shows.filter((f) => isInProgress(f, progresses));
  const byRoot = new Map<string, LocalFile>();

  for (const ep of inProgress) {
    const root = getSeriesRootFromFile(ep) || getSeriesRoot(ep.relativePath);
    if (!root) continue;
    const existing = byRoot.get(root);
    const existingPos = existing ? (progresses[existing.path] ?? 0) : -1;
    const epPos = progresses[ep.path] ?? 0;
    if (!existing || epPos > existingPos) {
      byRoot.set(root, ep);
    }
  }

  return Array.from(byRoot.entries()).map(([root, resumeEpisode]) => {
    const folder = seriesFolders.find((f) => f.path === `folder://${root}`);
    if (!folder) {
      return { ...resumeEpisode, resumeEpisode };
    }
    return { ...folder, resumeEpisode };
  });
}

export function buildContinueWatchingAll(
  movies: LocalFile[],
  shows: LocalFile[],
  progresses: Record<string, number>,
  seriesFolders: LocalFile[],
): LocalFile[] {
  const movieItems = buildContinueWatchingMovies(movies, progresses);
  const seriesItems = buildContinueWatchingSeries(shows, progresses, seriesFolders);
  return [...movieItems, ...seriesItems];
}

export function buildTop10(
  movies: LocalFile[],
  shows: LocalFile[],
  playCounts: Record<string, number>,
  seriesFolders: LocalFile[],
): LocalFile[] {
  type Scored = { item: LocalFile; count: number };

  const scored: Scored[] = [];

  for (const movie of movies) {
    const count = playCounts[movie.path] ?? 0;
    if (count > 0) scored.push({ item: movie, count });
  }

  const seriesCounts = new Map<string, number>();
  for (const ep of shows) {
    const root = getSeriesRootFromFile(ep) || getSeriesRoot(ep.relativePath);
    if (!root) continue;
    const count = playCounts[ep.path] ?? 0;
    if (count <= 0) continue;
    seriesCounts.set(root, (seriesCounts.get(root) ?? 0) + count);
  }

  for (const [root, count] of seriesCounts) {
    const folder = seriesFolders.find((f) => f.path === `folder://${root}`);
    if (folder) scored.push({ item: folder, count });
  }

  return scored
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((s) => s.item);
}

export function buildSearchCatalog(movies: LocalFile[], seriesFolders: LocalFile[]): LocalFile[] {
  return [...movies, ...seriesFolders];
}

export function buildHeroCatalog(movies: LocalFile[], seriesFolders: LocalFile[]): LocalFile[] {
  return [...movies, ...seriesFolders];
}

/** Episode to play from a series folder card (resume or first). */
export function resolvePlayTarget(video: LocalFile): LocalFile {
  if (video.resumeEpisode) return video.resumeEpisode;
  if (video.isFolder && video.folderFiles?.length) return video.folderFiles[0];
  return video;
}

/** Progress fraction for a card (handles resumeEpisode). */
export function cardProgress(
  video: LocalFile,
  progresses: Record<string, number>,
): number | undefined {
  const src = video.resumeEpisode ?? video;
  const pos = progresses[src.path];
  if (pos === undefined || !src.duration) return undefined;
  return pos / src.duration;
}

export function getItemGenres(item: LocalFile): string[] {
  const seen = new Set<string>();
  const genres: string[] = [];

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || JUNK_GENRES.has(trimmed) || seen.has(trimmed)) return;
    seen.add(trimmed);
    genres.push(trimmed);
  };

  if (item.meta?.genre) {
    for (const part of item.meta.genre.split(',')) add(part);
  }

  if (!isTmdbDisabled(item)) {
    const cached = getCachedForVideo(item);
    for (const genre of cached?.genres ?? []) add(genre);
  }

  return genres;
}

export function buildGenreRows(
  items: LocalFile[],
  options?: { minItems?: number },
): { title: string; videos: LocalFile[] }[] {
  const minItems = options?.minItems ?? 2;
  const genreMap = new Map<string, LocalFile[]>();

  for (const item of items) {
    for (const genre of getItemGenres(item)) {
      if (!genreMap.has(genre)) genreMap.set(genre, []);
      genreMap.get(genre)!.push(item);
    }
  }

  return Array.from(genreMap.entries())
    .filter(([, videos]) => videos.length >= minItems)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, videos]) => ({ title, videos }));
}

/** Open the series detail modal for an episode, with the season tab that contains it. */
export function resolveShowDetailTarget(
  files: LocalFile[],
  file: LocalFile,
): { show: LocalFile; seasonKey: string } | null {
  if (file.isFolder || (file.category !== 'tv' && file.category !== 'anime')) return null;
  const targetKey = normPath(file.path);

  for (const f of files) {
    if (!f.isFolder || !f.folderFiles) continue;
    for (const ep of f.folderFiles) {
      if (normPath(ep.path) === targetKey) {
        return { show: f, seasonKey: getSeasonGroupKey(ep.relativePath) };
      }
    }
  }

  const shows = files.filter((f) => (f.category === 'tv' || f.category === 'anime') && !f.isFolder);
  const folders = buildSeriesFolders(shows);
  for (const show of folders) {
    for (const ep of show.folderFiles ?? []) {
      if (normPath(ep.path) === targetKey) {
        return { show, seasonKey: getSeasonGroupKey(ep.relativePath) };
      }
    }
  }
  return null;
}
