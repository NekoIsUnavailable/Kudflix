import type { LocalFile } from '../components/NetflixUI';
import { getSeriesRootFromFile } from './grouping';
import { getMediaOverride } from './mediaOverrides';
import { parseSeriesFolderName } from './metadata';

/** Title shown on library cards and detail headers. */
export function getLibraryDisplayTitle(video: LocalFile): string {
  return video.meta?.title || video.name;
}

/** Primary title in the player chrome, series name for episodes, same as library for movies. */
export function getPlayerDisplayTitle(video: LocalFile): string {
  if (video.isFolder) return getLibraryDisplayTitle(video);

  const root = getSeriesRootFromFile(video);
  if ((video.category === 'tv' || video.category === 'anime') && root) {
    const folderKey = `folder://${root}`;
    const overrideTitle = getMediaOverride(folderKey)?.title?.trim();
    if (overrideTitle) return overrideTitle;

    const { title } = parseSeriesFolderName(root);
    if (title) return title;
  }

  return getLibraryDisplayTitle(video);
}
