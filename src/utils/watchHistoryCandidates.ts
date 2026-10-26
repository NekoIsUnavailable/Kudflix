import type { LocalFile } from '../components/NetflixUI';
import { getPlayerDisplayTitle } from './displayTitle';
import { getSeriesRootFromFile } from './grouping';
import { hasPartialProgress, isWatched } from './watched';

export type CandidateStatus = 'watched' | 'partial';

export interface WatchHistoryCandidate {
  path: string;
  video: LocalFile;
  status: CandidateStatus;
  position: number;
  duration: number;
  completed: boolean;
  seriesKey: string | null;
  seriesTitle: string | null;
}

function resolvePositionAndDuration(
  video: LocalFile,
  progresses: Record<string, number>,
  watched: boolean,
): { position: number; duration: number; completed: boolean } {
  const dur = video.duration ?? 0;
  const pos = progresses[video.path] ?? 0;

  if (pos > 0) {
    const duration = dur > 0 ? dur : Math.max(pos, 1);
    const completed = watched || (duration > 0 && pos / duration >= 0.9);
    return { position: pos, duration, completed };
  }

  if (watched && dur > 0) {
    return { position: dur * 0.95, duration: dur, completed: true };
  }

  if (watched) {
    return { position: 0, duration: 0, completed: true };
  }

  return { position: pos, duration: dur, completed: false };
}

/** Library titles with watched status or partial progress (playable files only). */
export function collectWatchHistoryCandidates(
  files: LocalFile[],
  progresses: Record<string, number>,
  profileId: string,
): WatchHistoryCandidate[] {
  const out: WatchHistoryCandidate[] = [];

  for (const file of files) {
    if (file.isFolder) continue;

    const watched = isWatched(file, progresses, profileId);
    const partial =
      !watched &&
      (hasPartialProgress(file.path, file.duration, progresses) ||
        (progresses[file.path] ?? 0) > 5);

    if (!watched && !partial) continue;

    const { position, duration, completed } = resolvePositionAndDuration(file, progresses, watched);
    const isTv = file.category === 'tv';
    const root = isTv ? getSeriesRootFromFile(file) : null;
    const seriesTitle = isTv && root ? getPlayerDisplayTitle(file) : null;

    out.push({
      path: file.path,
      video: file,
      status: watched ? 'watched' : 'partial',
      position,
      duration,
      completed,
      seriesKey: isTv && root ? root : null,
      seriesTitle,
    });
  }

  out.sort((a, b) => {
    const sa = a.seriesTitle ?? a.video.meta?.title ?? a.video.name;
    const sb = b.seriesTitle ?? b.video.meta?.title ?? b.video.name;
    return sa.localeCompare(sb, undefined, { sensitivity: 'base' });
  });

  return out;
}

export function groupCandidatesBySeries(
  candidates: WatchHistoryCandidate[],
): { key: string; title: string; items: WatchHistoryCandidate[] }[] {
  const map = new Map<string, WatchHistoryCandidate[]>();
  const titles = new Map<string, string>();

  for (const c of candidates) {
    if (c.seriesKey) {
      if (!map.has(c.seriesKey)) map.set(c.seriesKey, []);
      map.get(c.seriesKey)!.push(c);
      if (c.seriesTitle) titles.set(c.seriesKey, c.seriesTitle);
    }
  }

  return Array.from(map.entries())
    .map(([key, items]) => ({
      key,
      title: titles.get(key) ?? key,
      items,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
