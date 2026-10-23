import type { LocalFile } from '../components/NetflixUI';
import { getSeriesRootFromFile } from './grouping';
import { getMediaOverride } from './mediaOverrides';

export const DEFAULT_OUTRO_WINDOW_SECONDS = 20;

export function seriesOverridePathForVideo(
  video: Pick<LocalFile, 'path' | 'isFolder' | 'relativePath' | 'folderName'>,
): string | null {
  if (video.isFolder) return video.path;
  const root = getSeriesRootFromFile(video);
  return root ? `folder://${root}` : null;
}

export function getShowSkipSettings(
  video: Pick<LocalFile, 'path' | 'isFolder' | 'relativePath' | 'folderName'>,
): { outroSkipSeconds: number } {
  const key = seriesOverridePathForVideo(video);
  const override = key ? getMediaOverride(key) : undefined;
  const outro = override?.outroSkipSeconds;
  return {
    outroSkipSeconds: typeof outro === 'number' && outro > 0 ? outro : 0,
  };
}

export function resolveOutroWindowSeconds(outroSkipSeconds: number): number {
  return outroSkipSeconds > 0 ? outroSkipSeconds : DEFAULT_OUTRO_WINDOW_SECONDS;
}

/** Parse seconds from edit form; empty clears override. */
export function parseSkipSecondsField(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}
