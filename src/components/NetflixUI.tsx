import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Play, ChevronLeft, ChevronRight, X, Edit2, Save, Shuffle, FolderOpen, Eye, EyeOff, MoreVertical, BookmarkPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  formatTmdbGenres,
  getCachedEpisodeMeta,
  onTmdbEpisodeRetry,
  resolveEpisodeNumbers,
  getSeasonGroupKey,
  prefetchEpisodeMetaBatch,
  scheduleTmdbRetries,
  tmdbArtwork,
  tmdbMatchLabel,
  type TMDBEpisodeMeta,
} from '../utils/tmdb';
import { enrichEpisodesBatch } from '../utils/libraryLoader';
import { useTMDB } from '../hooks/useTMDB';
import { useTMDBDetails } from '../hooks/useTMDBDetails';
import { getMediaOverride, isTmdbDisabled, type MediaOverride } from '../utils/mediaOverrides';
import { parseSkipSecondsField } from '../utils/showSkip';
import { useImageBrightness } from '../hooks/useImageBrightness';
import { EpisodeRow } from './EpisodeRow';
import { WatchedEyeIndicator } from './WatchedEyeIndicator';
import type { Settings } from './SettingsModal';
import { cardProgress, resolvePlayTarget } from '../utils/grouping';
import { formatDurationShort } from '../utils/subtitles';
import {
  isWatched,
  isSeriesWatched,
  isSeasonWatched,
  matchesGridWatchedFilter,
  setManualWatched,
  setSeriesWatched,
  setEpisodesWatched,
} from '../utils/watched';
import { UserListsMenu, VideoCardListButton } from './UserListsMenu';
import { UserListGridModal } from './UserListGridModal';
import { listKindForVideo } from '../utils/userLists';
import { ThemedSelect, GRID_SORT_OPTIONS, GRID_FILTER_OPTIONS } from './ThemedSelect';
import { ConfirmDialog } from './ConfirmDialog';
import { recordWatchHistoryFromMark } from '../utils/watchHistory';

// --- Types ---
export interface LocalFile {
  name: string;
  path: string;
  relativePath?: string;
  category?: 'movie' | 'tv' | 'anime';
  meta?: { title?: string; description?: string; poster?: string | null; year?: string; genre?: string; };
  thumbnail?: string;
  duration?: number;
  dateModified?: number;
  localPoster?: string | null;
  localFanart?: string | null;
  localNfoContent?: string | null;
  folderName?: string;
  isFolder?: boolean;
  folderFiles?: LocalFile[];
  resumeEpisode?: LocalFile;
  tmdbDisabled?: boolean;
}

function getDisplayTitle(video: LocalFile) {
  return video.meta?.title || video.name;
}

export function getVideoWatched(
  video: LocalFile,
  progresses: Record<string, number>,
  profileId: string | null | undefined,
): boolean {
  if (video.isFolder) return isSeriesWatched(video, progresses, profileId);
  return isWatched(video, progresses, profileId);
}

function getExplorerPath(video: LocalFile): string | null {
  if (video.isFolder && video.folderFiles?.length) {
    const epPath = video.folderFiles[0].path;
    const sep = Math.max(epPath.lastIndexOf('\\'), epPath.lastIndexOf('/'));
    return sep >= 0 ? epPath.slice(0, sep) : epPath;
  }
  if (video.path.startsWith('folder://')) return null;
  return video.path;
}

// --- Thumbnail title with Bebas Neue + adaptive contrast ---
function ThumbnailTitle({ title, imageSrc, className = '' }: { title: string; imageSrc?: string; className?: string }) {
  const brightness = useImageBrightness(imageSrc);
  const isLight = brightness === 'light';

  return (
    <>
      <div
        className={`absolute bottom-0 left-0 right-0 h-14 pointer-events-none ${
          isLight ? 'bg-gradient-to-t from-white/80 via-white/30 to-transparent' : 'bg-gradient-to-t from-black/80 via-black/30 to-transparent'
        }`}
      />
      <div
        className={`absolute bottom-2 left-2 right-2 truncate font-bebas tracking-wide text-base leading-tight z-10 ${
          isLight ? 'text-black' : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]'
        } ${className}`}
      >
        {title}
      </div>
    </>
  );
}

// --- Grid View Modal ---
type GridSort = 'az' | 'za' | 'year-new' | 'year-old' | 'recent' | 'duration-short' | 'duration-long';
type GridFilter = 'all' | 'unwatched' | 'watched';

function getSortTitle(video: LocalFile) {
  return (video.meta?.title || video.name).toLowerCase();
}

function getSortYear(video: LocalFile) {
  const y = video.meta?.year;
  return y ? parseInt(y, 10) || 0 : 0;
}

function getSortDuration(video: LocalFile): number {
  if (video.isFolder && video.folderFiles?.length) {
    return video.folderFiles.reduce((sum, ep) => sum + (ep.duration ?? 0), 0);
  }
  return video.duration ?? 0;
}

export function GridViewModal({
  title,
  videos,
  onClose,
  onPlay,
  onInfo,
  progresses = {},
  sortable = false,
  showRandomPlay = false,
  activeProfileId,
  mediaType,
  watchedIndicatorMode = 'always',
}: {
  title: string;
  videos: LocalFile[];
  onClose: () => void;
  onPlay: (v: LocalFile) => void;
  onInfo: (v: LocalFile) => void;
  progresses?: Record<string, number>;
  sortable?: boolean;
  showRandomPlay?: boolean;
  activeProfileId?: string | null;
  mediaType?: 'movie' | 'tv';
  watchedIndicatorMode?: Settings['watchedIndicatorMode'];
}) {
  const [sort, setSort] = useState<GridSort>('az');
  const [filter, setFilter] = useState<GridFilter>('all');

  const sortedVideos = useMemo(() => {
    let list = [...videos];

    if (activeProfileId && filter !== 'all') {
      list = list.filter((v) =>
        matchesGridWatchedFilter(v, filter, progresses, activeProfileId, mediaType),
      );
    }

    if (!sortable) return list;
    switch (sort) {
      case 'az':
        return list.sort((a, b) => getSortTitle(a).localeCompare(getSortTitle(b)));
      case 'za':
        return list.sort((a, b) => getSortTitle(b).localeCompare(getSortTitle(a)));
      case 'year-new':
        return list.sort((a, b) => getSortYear(b) - getSortYear(a));
      case 'year-old':
        return list.sort((a, b) => getSortYear(a) - getSortYear(b));
      case 'recent':
        return list.sort((a, b) => (b.dateModified ?? 0) - (a.dateModified ?? 0));
      case 'duration-short':
        return list.sort((a, b) => getSortDuration(a) - getSortDuration(b));
      case 'duration-long':
        return list.sort((a, b) => getSortDuration(b) - getSortDuration(a));
      default:
        return list;
    }
  }, [videos, sort, sortable, filter, activeProfileId, mediaType, progresses]);

  const playRandom = () => {
    if (sortedVideos.length === 0) return;
    const pick = sortedVideos[Math.floor(Math.random() * sortedVideos.length)];
    onClose();
    onPlay(pick);
  };

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, []);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[500] bg-[#141414] flex flex-col pt-24"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          className="flex flex-col flex-1 min-h-0 overflow-visible"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-10 pb-4 shrink-0">
            <h2 className="text-3xl md:text-4xl font-bold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 bg-[#181818]/80 rounded-full hover:bg-white hover:text-black transition text-white border border-white/20"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {(sortable || showRandomPlay || activeProfileId) && (
            <div className="flex items-center gap-4 px-10 pb-6 shrink-0 flex-wrap">
              {sortable && (
                <ThemedSelect
                  value={sort}
                  onChange={setSort}
                  options={GRID_SORT_OPTIONS}
                  className="w-auto"
                  buttonClassName="w-auto min-w-[10rem]"
                  menuZIndex={550}
                />
              )}
              {activeProfileId && (
                <ThemedSelect
                  value={filter}
                  onChange={setFilter}
                  options={GRID_FILTER_OPTIONS}
                  className="w-auto"
                  buttonClassName="w-auto min-w-[9rem]"
                  menuZIndex={550}
                />
              )}
              {showRandomPlay && (
                <button
                  onClick={playRandom}
                  className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded font-bold text-sm hover:bg-white/80 transition"
                >
                  <Shuffle className="w-4 h-4" /> Play random
                </button>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-10 pl-14 pb-10 min-h-0 overscroll-contain">
            <div className="pt-32 pl-4 pr-6 pb-12 overflow-visible">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-20 overflow-visible">
              {sortedVideos.map((video, i) => (
                <div key={`${video.path}-${i}`} className="relative hover:z-[600] overflow-visible">
                  <VideoCard
                    video={video}
                    onPlay={(v) => { onClose(); onPlay(v); }}
                    onInfo={(v) => { onClose(); onInfo(v); }}
                    variant="grid"
                    enableHoverExpansion
                    progress={cardProgress(video, progresses)}
                    watched={getVideoWatched(video, progresses, activeProfileId)}
                    watchedIndicatorMode={watchedIndicatorMode}
                    activeProfileId={activeProfileId}
                  />
                </div>
              ))}
            </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

function EditToggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
}) {
  return (
    <div
      className="flex items-start gap-2.5 bg-gray-800/30 p-3 rounded-lg border border-gray-800 cursor-pointer hover:bg-gray-800/50 transition h-full"
      onClick={() => onChange(!checked)}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 accent-accent flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex-grow min-w-0">
        <span className="text-sm font-semibold text-white block leading-snug">{title}</span>
        {description && <span className="text-xs text-gray-500 block mt-0.5 leading-snug">{description}</span>}
      </div>
    </div>
  );
}

// --- Detail Modal ---
export function DetailModal({
  video,
  onClose,
  onPlay,
  onUpdate,
  onReset,
  onEpisodeEnriched,
  progresses = {},
  activeProfileId,
  onWatchedChange,
  watchedIndicatorMode = 'always',
  watchedRevision = 0,
  detailModalActionsMode = 'menu',
  initialSubfolder,
}: {
  video: LocalFile;
  onClose: () => void;
  onPlay: (v: LocalFile) => void;
  onUpdate?: (path: string, override: MediaOverride) => void;
  onReset?: (path: string) => void;
  onEpisodeEnriched?: (enriched: LocalFile[]) => void;
  progresses?: Record<string, number>;
  activeProfileId?: string | null;
  onWatchedChange?: () => void;
  watchedIndicatorMode?: Settings['watchedIndicatorMode'];
  watchedRevision?: number;
  detailModalActionsMode?: Settings['detailModalActionsMode'];
  /** When opening a series, pre-select this season folder (episode info from history, etc.). */
  initialSubfolder?: string;
}) {
  const useLocalOnly = isTmdbDisabled(video);
  const tmdb = useTMDBDetails(video);
  const [isEditing, setIsEditing] = useState(false);
  const currentOverride = getMediaOverride(video.path);
  const [editForm, setEditForm] = useState({
    title: video.meta?.title || video.name,
    description: video.meta?.description || '',
    genre: video.meta?.genre || '',
    year: video.meta?.year || '',
    provider: currentOverride?.provider ?? (video.category === 'anime' ? ('anilist' as const) : ('tmdb' as const)),
    tmdbId: currentOverride?.tmdbId ?? '',
    anilistId: currentOverride?.anilistId ?? '',
    disableTmdb: currentOverride?.disableTmdb ?? false,
    useSeriesThumbnailForEpisodes: currentOverride?.useSeriesThumbnailForEpisodes ?? false,
    outroSkipSeconds:
      currentOverride?.outroSkipSeconds != null
        ? String(currentOverride.outroSkipSeconds)
        : '',
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [heroOverflowOpen, setHeroOverflowOpen] = useState(false);
  const [heroListsOpen, setHeroListsOpen] = useState(false);
  const heroOverflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ov = getMediaOverride(video.path);
    setEditForm({
      title: video.meta?.title || video.name,
      description: video.meta?.description || '',
      genre: video.meta?.genre || '',
      year: video.meta?.year || '',
      provider: ov?.provider ?? (video.category === 'anime' ? 'anilist' : 'tmdb'),
      tmdbId: ov?.tmdbId ?? '',
      anilistId: ov?.anilistId ?? '',
      disableTmdb: ov?.disableTmdb ?? false,
      useSeriesThumbnailForEpisodes: ov?.useSeriesThumbnailForEpisodes ?? false,
      outroSkipSeconds:
        ov?.outroSkipSeconds != null ? String(ov.outroSkipSeconds) : '',
    });
    setEditError(null);
    setIsEditing(false);
    setShowResetConfirm(false);
    setHeroOverflowOpen(false);
    setHeroListsOpen(false);
  }, [video.path, video.category, video.meta?.title, video.meta?.description, video.meta?.genre, video.meta?.year, video.name, video.tmdbDisabled]);

  useEffect(() => {
    if (!heroOverflowOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (heroOverflowRef.current && !heroOverflowRef.current.contains(e.target as Node)) {
        setHeroOverflowOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [heroOverflowOpen]);

  const handleSaveEdits = () => {
    const trimmedTmdbId = editForm.tmdbId.trim();
    if (trimmedTmdbId && !/^\d+$/.test(trimmedTmdbId)) {
      setEditError('TMDB ID must be a number.');
      return;
    }
    const trimmedAniListId = editForm.anilistId.trim();
    if (trimmedAniListId && !/^\d+$/.test(trimmedAniListId)) {
      setEditError('AniList ID must be a number.');
      return;
    }
    setEditError(null);
    const outroParsed = video.isFolder ? parseSkipSecondsField(editForm.outroSkipSeconds) : undefined;
    if (video.isFolder && editForm.outroSkipSeconds.trim() && outroParsed === undefined) {
      setEditError('Outro skip must be a non-negative number of seconds.');
      return;
    }

    const override: MediaOverride = {
      title: editForm.title.trim() || undefined,
      description: editForm.description.trim() || undefined,
      genre: editForm.genre.trim() || undefined,
      year: editForm.year.trim() || undefined,
      provider: editForm.provider,
      tmdbId: trimmedTmdbId,
      anilistId: trimmedAniListId,
      disableTmdb: editForm.disableTmdb,
      useSeriesThumbnailForEpisodes: video.isFolder ? editForm.useSeriesThumbnailForEpisodes : undefined,
      outroSkipSeconds: video.isFolder ? outroParsed : undefined,
    };
    onUpdate?.(video.path, override);
    setIsEditing(false);
  };

  void watchedRevision;
  const movieWatched = !video.isFolder && isWatched(video, progresses, activeProfileId);

  const toggleMovieWatched = (checked: boolean) => {
    if (!activeProfileId || video.isFolder) return;
    setManualWatched(activeProfileId, video.path, checked);
    if (checked) void recordWatchHistoryFromMark(activeProfileId, [video], progresses);
    onWatchedChange?.();
  };

  const toggleEpisodeWatched = (ep: LocalFile) => {
    if (!activeProfileId) return;
    const w = isWatched(ep, progresses, activeProfileId);
    const markingWatched = !w;
    setManualWatched(activeProfileId, ep.path, markingWatched);
    if (markingWatched) void recordWatchHistoryFromMark(activeProfileId, [ep], progresses);
    onWatchedChange?.();
  };

  const toggleSeriesWatched = (checked: boolean) => {
    if (!activeProfileId || !video.isFolder) return;
    setSeriesWatched(activeProfileId, video, checked ? true : null);
    if (checked && video.folderFiles?.length) {
      void recordWatchHistoryFromMark(activeProfileId, video.folderFiles, progresses);
    }
    onWatchedChange?.();
  };

  const toggleSeasonWatched = (checked: boolean) => {
    if (!activeProfileId || !video.isFolder) return;
    const seasonEps = subfolders[selectedSubfolder] ?? [];
    setEpisodesWatched(activeProfileId, seasonEps, checked ? true : null);
    if (!checked) setManualWatched(activeProfileId, video.path, null);
    if (checked && seasonEps.length) {
      void recordWatchHistoryFromMark(activeProfileId, seasonEps, progresses);
    }
    onWatchedChange?.();
  };

  const forceSeriesThumbnail = getMediaOverride(video.path)?.useSeriesThumbnailForEpisodes;

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, []);

  const [selectedSubfolder, setSelectedSubfolder] = useState<string>('');
  const [hideWatchedEpisodes, setHideWatchedEpisodes] = useState(false);

  const subfolders = useMemo(() => {
    if (!video.isFolder || !video.folderFiles) return {};
    const groups: Record<string, LocalFile[]> = {};
    video.folderFiles.forEach(f => {
      const sub = getSeasonGroupKey(f.relativePath);
      if (!groups[sub]) groups[sub] = [];
      groups[sub].push(f);
    });
    return groups;
  }, [video.isFolder, video.folderFiles, video.path]);

  const subfolderNames = Object.keys(subfolders).sort((a,b) => a.localeCompare(b, undefined, {numeric:true}));
  const subfolderNamesKey = subfolderNames.join('\0');

  useEffect(() => {
    if (subfolderNames.length === 0) {
      setSelectedSubfolder('');
      return;
    }
    if (initialSubfolder && subfolderNames.includes(initialSubfolder)) {
      setSelectedSubfolder(initialSubfolder);
    } else {
      setSelectedSubfolder(subfolderNames[0]!);
    }
  }, [video.path, initialSubfolder, subfolderNamesKey]);

  const episodesToRender = subfolders[selectedSubfolder] || [];
  const visibleEpisodes = hideWatchedEpisodes
    ? episodesToRender.filter((ep) => !isWatched(ep, progresses, activeProfileId))
    : episodesToRender;
  const episodePathsKey = episodesToRender.map((ep) => ep.path).join('\0');

  useEffect(() => {
    setHideWatchedEpisodes(false);
  }, [video.path, selectedSubfolder]);

  const seriesWatched = Boolean(
    video.isFolder && activeProfileId && isSeriesWatched(video, progresses, activeProfileId),
  );
  const seasonWatched = Boolean(
    video.isFolder && activeProfileId && isSeasonWatched(episodesToRender, progresses, activeProfileId),
  );

  const folderPlayTarget = (() => {
    if (!video.isFolder || !video.folderFiles?.length) return null;
    if (hideWatchedEpisodes && visibleEpisodes[0]) return visibleEpisodes[0];
    const unwatched = episodesToRender.find((ep) => !isWatched(ep, progresses, activeProfileId));
    return unwatched ?? episodesToRender[0] ?? video.folderFiles[0];
  })();
  const episodeCount = video.folderFiles?.length ?? 0;
  const heroArtwork = useLocalOnly ? tmdbArtwork(null, video) : tmdbArtwork(tmdb, video);
  const totalRuntime = video.folderFiles?.reduce((sum, ep) => sum + (ep.duration ?? 0), 0) ?? 0;
  const [episodeMetaMap, setEpisodeMetaMap] = useState<Record<string, TMDBEpisodeMeta | null>>({});
  const seriesThumbnail = heroArtwork || video.thumbnail || video.localFanart || video.localPoster || undefined;

  useEffect(() => {
    if (!video.isFolder || episodesToRender.length === 0 || !onEpisodeEnriched) return;

    const needsEnrich = episodesToRender.filter(
      (ep) => !ep.thumbnail || !(ep.duration && ep.duration > 0),
    );
    if (needsEnrich.length === 0) return;

    let cancelled = false;
    enrichEpisodesBatch(needsEnrich, (batch) => {
      if (!cancelled) onEpisodeEnriched(batch);
    });

    return () => {
      cancelled = true;
    };
  }, [video.path, episodePathsKey, onEpisodeEnriched]);

  useEffect(() => {
    if (!video.isFolder || useLocalOnly || !tmdb?.tvId || episodesToRender.length === 0) {
      setEpisodeMetaMap({});
      return;
    }

    const parsedEpisodes = episodesToRender
      .map((ep) => {
        const parsed = resolveEpisodeNumbers(ep.name, ep.relativePath);
        return parsed ? { ep, parsed } : null;
      })
      .filter((item): item is { ep: LocalFile; parsed: { season: number; episode: number } } => item !== null);

    if (parsedEpisodes.length === 0) {
      setEpisodeMetaMap({});
      return;
    }

    let cancelled = false;

    const loadEpisodeMeta = async () => {
      await prefetchEpisodeMetaBatch(
        tmdb.tvId!,
        parsedEpisodes.map((item) => item.parsed),
      );
      if (cancelled) return;

      const map: Record<string, TMDBEpisodeMeta | null> = {};
      for (const { ep, parsed } of parsedEpisodes) {
        const cached = getCachedEpisodeMeta(tmdb.tvId!, parsed.season, parsed.episode);
        if (cached !== undefined) map[ep.path] = cached;
      }
      setEpisodeMetaMap(map);
    };

    loadEpisodeMeta();
    scheduleTmdbRetries();
    const retryTimer = setTimeout(() => {
      if (!cancelled) loadEpisodeMeta();
    }, 12_000);

    const unsubRetry = onTmdbEpisodeRetry(() => {
      if (!cancelled) loadEpisodeMeta();
    });

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      unsubRetry();
    };
  }, [video.path, tmdb?.tvId, useLocalOnly, selectedSubfolder, episodePathsKey]);

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black/80 flex flex-col items-center pt-10 px-4 overflow-y-auto"
        onClick={onClose}
      >
        <motion.div 
          initial={{ y: 50, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.95 }}
          className="bg-[#181818] w-full max-w-4xl rounded-lg shadow-2xl overflow-hidden relative mb-10 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute top-0 right-0 z-[100] p-3 pointer-events-none">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="pointer-events-auto flex items-center justify-center w-12 h-12 min-w-[3rem] min-h-[3rem] rounded-full bg-black/80 hover:bg-white hover:text-black text-white border border-white/40 transition cursor-pointer shadow-lg"
              aria-label="Close"
            >
              <X size={24} strokeWidth={2.5} aria-hidden />
            </button>
          </div>

          {/* Hero Image */}
          <div className="relative w-full aspect-[16/7]">
            {heroArtwork ? (
              <img src={heroArtwork} alt={video.meta?.title || video.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-gray-800 to-black" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/20 to-transparent" />
            <div className="absolute bottom-6 left-10 max-w-2xl">
              <h2 className="text-4xl md:text-5xl font-bold text-white drop-shadow-md mb-6">{getDisplayTitle(video)}</h2>
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    if (video.isFolder && video.folderFiles && video.folderFiles.length > 0) {
                      onPlay(folderPlayTarget || video.folderFiles[0]);
                    } else {
                      onPlay(video);
                    }
                  }}
                  className="flex items-center gap-2 bg-white text-black px-8 py-2 rounded font-bold hover:bg-white/80 transition"
                >
                  <Play className="w-6 h-6 fill-black" /> Play
                </button>
                {detailModalActionsMode === 'icons' && onUpdate && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(!isEditing)}
                    aria-label={isEditing ? 'Cancel edit' : 'Edit metadata'}
                    className="flex items-center justify-center w-10 h-10 rounded bg-gray-600/80 text-white hover:bg-gray-500/80 transition"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                )}
                {activeProfileId && detailModalActionsMode === 'icons' && (
                  <UserListsMenu
                    profileId={activeProfileId}
                    itemPath={video.path}
                    kind={listKindForVideo(video)}
                    variant="icon-detail"
                  />
                )}
                {detailModalActionsMode === 'menu' && (onUpdate || activeProfileId) && (
                  <>
                    {heroListsOpen && activeProfileId ? (
                      <UserListsMenu
                        profileId={activeProfileId}
                        itemPath={video.path}
                        kind={listKindForVideo(video)}
                        variant="icon-detail"
                        open={heroListsOpen}
                        onOpenChange={(open) => {
                          setHeroListsOpen(open);
                          if (!open) setHeroOverflowOpen(false);
                        }}
                      />
                    ) : (
                      <div className="relative" ref={heroOverflowRef}>
                        <button
                          type="button"
                          aria-label="More actions"
                          aria-expanded={heroOverflowOpen}
                          onClick={() => setHeroOverflowOpen((o) => !o)}
                          className="flex items-center justify-center w-10 h-10 rounded bg-gray-600/80 text-white hover:bg-gray-500/80 transition"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        {heroOverflowOpen && (
                          <div className="absolute left-0 top-full mt-2 z-[300] min-w-[11rem] rounded-lg border border-white/15 bg-[#2a2a2a] shadow-2xl py-1 overflow-hidden">
                            {onUpdate && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsEditing(!isEditing);
                                  setHeroOverflowOpen(false);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-white hover:bg-white/10 transition"
                              >
                                <Edit2 className="w-4 h-4 shrink-0" />
                                {isEditing ? 'Cancel edit' : 'Edit metadata'}
                              </button>
                            )}
                            {activeProfileId && (
                              <button
                                type="button"
                                onClick={() => {
                                  setHeroOverflowOpen(false);
                                  setHeroListsOpen(true);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-white hover:bg-white/10 transition"
                              >
                                <BookmarkPlus className="w-4 h-4 shrink-0" />
                                Lists
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Info Section */}
          <div className="p-10 flex flex-col md:flex-row gap-12">
            <div className="flex-1">
              <div className="flex items-center gap-3 text-sm text-gray-400 font-semibold mb-6 flex-wrap">
                {!useLocalOnly && tmdb && (
                  <span className="text-green-400">{tmdbMatchLabel(tmdb)}</span>
                )}
                {(video.meta?.year || (!useLocalOnly && tmdb?.year)) && (
                  <span>{video.meta?.year || (!useLocalOnly ? tmdb?.year : undefined)}</span>
                )}
                {video.isFolder && episodeCount > 0 && (
                  <span>{episodeCount} {episodeCount === 1 ? 'Episode' : 'Episodes'}</span>
                )}
                {!video.isFolder && video.duration != null && video.duration > 0 && (
                  <span>{formatDurationShort(video.duration)}</span>
                )}
                <span className="border border-gray-600 px-1.5 py-0.5 rounded text-xs">HD</span>
              </div>
              {isEditing ? (
                <div className="space-y-4 mb-8">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Title</label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="w-full bg-black/50 border border-gray-600 rounded-lg px-4 py-2 text-white outline-none focus:border-white transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Description</label>
                    <textarea
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={4}
                      className="w-full bg-black/50 border border-gray-600 rounded-lg px-4 py-2 text-white outline-none focus:border-white transition resize-none"
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Genre</label>
                      <input
                        type="text"
                        value={editForm.genre}
                        onChange={(e) => setEditForm({ ...editForm, genre: e.target.value })}
                        placeholder="e.g. Action, Drama"
                        className="w-full bg-black/50 border border-gray-600 rounded-lg px-4 py-2 text-white outline-none focus:border-white transition"
                      />
                    </div>
                    <div className="w-28">
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Year</label>
                      <input
                        type="text"
                        value={editForm.year}
                        onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                        placeholder="1985"
                        className="w-full bg-black/50 border border-gray-600 rounded-lg px-4 py-2 text-white outline-none focus:border-white transition"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Metadata Provider</label>
                    <div className="flex gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setEditForm({ ...editForm, provider: 'tmdb' })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                          editForm.provider !== 'anilist' ? 'bg-white text-black' : 'bg-zinc-800 text-gray-400 hover:text-white'
                        }`}
                      >
                        TMDB
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditForm({ ...editForm, provider: 'anilist' })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                          editForm.provider === 'anilist' ? 'bg-white text-black' : 'bg-zinc-800 text-gray-400 hover:text-white'
                        }`}
                      >
                        AniList (Anime)
                      </button>
                    </div>

                    {editForm.provider === 'anilist' ? (
                      <div>
                        <label className="text-xs font-semibold text-gray-500 block mb-1">AniList ID</label>
                        <input
                          type="text"
                          value={editForm.anilistId}
                          onChange={(e) => setEditForm({ ...editForm, anilistId: e.target.value })}
                          placeholder="e.g. 21355 from anilist.co"
                          className="w-full bg-black/50 border border-gray-600 rounded-lg px-4 py-2 text-white outline-none focus:border-white transition"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Optional. Find the anime ID on{' '}
                          <a href="https://anilist.co" className="text-gray-400 hover:text-white underline" target="_blank" rel="noreferrer">anilist.co</a>.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs font-semibold text-gray-500 block mb-1">TMDB ID</label>
                        <input
                          type="text"
                          value={editForm.tmdbId}
                          onChange={(e) => setEditForm({ ...editForm, tmdbId: e.target.value })}
                          placeholder={video.isFolder ? 'TV show ID from themoviedb.org' : 'Movie ID from themoviedb.org'}
                          className="w-full bg-black/50 border border-gray-600 rounded-lg px-4 py-2 text-white outline-none focus:border-white transition"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Optional. When set, metadata is fetched by ID instead of title search. Find it on{' '}
                          <a href="https://www.themoviedb.org" className="text-gray-400 hover:text-white underline" target="_blank" rel="noreferrer">themoviedb.org</a>.
                        </p>
                      </div>
                    )}
                  </div>
                  {video.isFolder && (
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Outro skip (seconds)</label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={editForm.outroSkipSeconds}
                        onChange={(e) => setEditForm({ ...editForm, outroSkipSeconds: e.target.value })}
                        placeholder="e.g. 60"
                        className="w-full bg-black/50 border border-gray-600 rounded-lg px-4 py-2 text-white outline-none focus:border-white transition"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Next Episode appears this many seconds before the end (default 20 if empty).
                      </p>
                    </div>
                  )}
                  {editError && <p className="text-xs text-red-400">{editError}</p>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <EditToggle
                      checked={editForm.disableTmdb}
                      onChange={(checked) => setEditForm({ ...editForm, disableTmdb: checked })}
                      title="Use local info only"
                      description="Disable TMDB metadata lookup for this title"
                    />
                    {video.isFolder && (
                      <EditToggle
                        checked={editForm.useSeriesThumbnailForEpisodes}
                        onChange={(checked) => setEditForm({ ...editForm, useSeriesThumbnailForEpisodes: checked })}
                        title="Use series thumbnail for all episodes"
                      />
                    )}
                    {!video.isFolder && activeProfileId && (
                      <EditToggle
                        checked={movieWatched}
                        onChange={toggleMovieWatched}
                        title="Mark as watched"
                      />
                    )}
                    {video.isFolder && activeProfileId && (
                      <EditToggle
                        checked={seriesWatched}
                        onChange={toggleSeriesWatched}
                        title="Mark entire show as watched"
                      />
                    )}
                    {video.isFolder && activeProfileId && subfolderNames.length > 1 && (
                      <EditToggle
                        checked={seasonWatched}
                        onChange={toggleSeasonWatched}
                        title="Mark season as watched"
                        description={selectedSubfolder}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSaveEdits}
                      className="flex items-center gap-2 bg-accent text-white px-6 py-2 rounded font-bold hover:opacity-90 transition"
                    >
                      <Save className="w-4 h-4" /> Save Changes
                    </button>
                    {onReset && (
                      <button
                        type="button"
                        onClick={() => setShowResetConfirm(true)}
                        className="text-sm text-red-400 hover:text-red-300 font-semibold transition"
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-gray-200 leading-relaxed text-base mb-8">
                  {(useLocalOnly ? video.meta?.description : (tmdb?.synopsis || video.meta?.description)) || 'No description available for this local file. This file was automatically indexed from your local folders.'}
                </p>
              )}

              {video.isFolder && subfolderNames.length > 0 && (
                <div className="mt-8 border-t border-gray-800 pt-8">
                  <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
                    <h3 className="text-2xl font-bold text-white">Episodes</h3>
                    <div className="flex items-center gap-3 flex-wrap">
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => setHideWatchedEpisodes((h) => !h)}
                          className={`flex items-center gap-2 px-4 py-2 rounded font-semibold text-sm transition border ${
                            hideWatchedEpisodes
                              ? 'bg-accent/20 border-accent text-white'
                              : 'bg-[#242424] border-gray-600 text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          {hideWatchedEpisodes ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          {hideWatchedEpisodes ? 'Show all' : 'Hide watched'}
                        </button>
                      )}
                      {subfolderNames.length > 1 && (
                        <ThemedSelect
                          value={selectedSubfolder}
                          onChange={setSelectedSubfolder}
                          options={subfolderNames.map((name) => ({ value: name, label: name }))}
                          className="w-auto min-w-[8rem]"
                          buttonClassName="w-auto min-w-[8rem]"
                          menuZIndex={250}
                        />
                      )}
                    </div>
                  </div>
                  
                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
                      {visibleEpisodes.length === 0 && hideWatchedEpisodes ? (
                        <p className="text-sm text-gray-500 py-4">
                          All watched episodes in this season are hidden.
                        </p>
                      ) : null}
                      {visibleEpisodes.map((ep, i) => (
                        <EpisodeRow
                          key={ep.path}
                          ep={ep}
                          index={i}
                          seriesTvId={useLocalOnly ? undefined : tmdb?.tvId}
                          episodeMeta={episodeMetaMap[ep.path]}
                          seriesThumbnail={seriesThumbnail}
                          forceSeriesThumbnail={forceSeriesThumbnail}
                          progress={
                            ep.duration && ep.duration > 0
                              ? (progresses[ep.path] ?? 0) / ep.duration
                              : undefined
                          }
                          watched={isWatched(ep, progresses, activeProfileId)}
                          watchedIndicatorMode={watchedIndicatorMode}
                          editMode={isEditing}
                          onToggleWatched={toggleEpisodeWatched}
                          onPlay={onPlay}
                        />
                      ))}
                    </div>
                </div>
              )}
            </div>
            
            <div className="w-full md:w-1/3 text-sm text-gray-400 space-y-6">
              <div>
                <span className="text-gray-500 block mb-1">File Path:</span>
                <div className="flex items-start gap-2 bg-black/20 p-2 rounded">
                  <div className="text-gray-300 break-all font-mono text-xs flex-1 min-w-0">
                    {getExplorerPath(video) ?? video.path}
                  </div>
                  {getExplorerPath(video) && (
                    <button
                      type="button"
                      onClick={() => window.electronAPI?.showInExplorer?.(getExplorerPath(video)!)}
                      className="flex-shrink-0 p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition"
                      aria-label="Show in file explorer"
                      title="Show in file explorer"
                    >
                      <FolderOpen className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              {(formatTmdbGenres(useLocalOnly ? null : tmdb, video.meta?.genre) ||
                (video.isFolder ? 'Series' : 'Local Media')) && (
                <div>
                  <span className="text-gray-500 block mb-1">Genres:</span>
                  <span className="text-gray-300">
                    {formatTmdbGenres(useLocalOnly ? null : tmdb, video.meta?.genre) ||
                      (video.isFolder ? 'Series' : 'Local Media')}
                  </span>
                </div>
              )}
              {!useLocalOnly && !video.isFolder && tmdb?.director && (
                <div>
                  <span className="text-gray-500 block mb-1">Director:</span>
                  <span className="text-gray-300">{tmdb.director}</span>
                </div>
              )}
              {!useLocalOnly && video.isFolder && tmdb?.creators && tmdb.creators.length > 0 && (
                <div>
                  <span className="text-gray-500 block mb-1">Created by:</span>
                  <span className="text-gray-300">{tmdb.creators.join(', ')}</span>
                </div>
              )}
              {!useLocalOnly && tmdb?.cast && tmdb.cast.length > 0 && (
                <div>
                  <span className="text-gray-500 block mb-1">Cast:</span>
                  <span className="text-gray-300">{tmdb.cast.join(', ')}</span>
                </div>
              )}
              {(video.meta?.year || (!useLocalOnly && tmdb?.year)) && (
                <div>
                  <span className="text-gray-500 block mb-1">Year:</span>
                  <span className="text-gray-300">{video.meta?.year || tmdb?.year}</span>
                </div>
              )}
              {!useLocalOnly && video.isFolder && tmdb?.seasons != null && tmdb.seasons > 0 && (
                <div>
                  <span className="text-gray-500 block mb-1">Seasons:</span>
                  <span className="text-gray-300">{tmdb.seasons}</span>
                </div>
              )}
              {video.isFolder && totalRuntime > 0 && (
                <div>
                  <span className="text-gray-500 block mb-1">Total Runtime:</span>
                  <span className="text-gray-300">{formatDurationShort(totalRuntime)}</span>
                </div>
              )}
              {!video.isFolder && (
                <div>
                  <span className="text-gray-500 block mb-1">Runtime:</span>
                  <span className="text-gray-300">
                    {video.duration != null && video.duration > 0
                      ? formatDurationShort(video.duration)
                      : !useLocalOnly && tmdb?.runtimeMinutes
                        ? formatDurationShort(tmdb.runtimeMinutes * 60)
                        : '—'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
      <ConfirmDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={() => {
          onReset?.(video.path);
          setIsEditing(false);
          setShowResetConfirm(false);
        }}
        title="Reset metadata?"
        confirmLabel="Reset"
        danger
        zIndex={700}
      >
        Reset this title to its default metadata? Manual edits and TMDB overrides will be removed.
      </ConfirmDialog>
    </AnimatePresence>
  );
}

// --- Video Card (Hover Jawlet) ---
export function VideoCard({
  video,
  onPlay,
  onInfo,
  progress,
  watched = false,
  watchedIndicatorMode = 'always',
  variant = 'carousel',
  enableHoverExpansion = false,
  activeProfileId,
}: {
  video: LocalFile;
  onPlay: (v: LocalFile) => void;
  onInfo: (v: LocalFile) => void;
  progress?: number;
  watched?: boolean;
  watchedIndicatorMode?: Settings['watchedIndicatorMode'];
  variant?: 'carousel' | 'grid';
  enableHoverExpansion?: boolean;
  activeProfileId?: string | null;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [listPickerOpen, setListPickerOpen] = useState(false);
  const hoverTimeoutRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const useLocalOnly = isTmdbDisabled(video);
  const tmdb = useTMDB(video);

  const isGrid = variant === 'grid';
  const allowHover = !isGrid || enableHoverExpansion;
  const cardImageSrc = useLocalOnly ? tmdbArtwork(null, video) : tmdbArtwork(tmdb, video);

  const playTarget = resolvePlayTarget(video);
  const useStaticPreview = video.isFolder && !video.resumeEpisode;
  const jawletPreviewSrc =
    useStaticPreview
      ? ((!useLocalOnly && tmdb?.backdrop) || video.thumbnail || cardImageSrc || undefined)
      : cardImageSrc;

  const handleMouseEnter = () => {
    if (!allowHover) return;
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(true);
    }, 400);
  };

  const handleMouseLeave = () => {
    if (!allowHover) return;
    if (listPickerOpen) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(false);
  };

  // List popover is portaled; leaving the card for the menu skips mouseLeave collapse until close.
  useLayoutEffect(() => {
    if (listPickerOpen) return;
    requestAnimationFrame(() => {
      if (!cardRef.current?.matches(':hover')) setIsHovered(false);
    });
  }, [listPickerOpen]);

  const folderTotalRuntime = video.folderFiles?.reduce((sum, ep) => sum + (ep.duration ?? 0), 0) ?? 0;

  return (
    <div 
      ref={cardRef}
      className={`relative rounded-md cursor-pointer transition-transform duration-300 ${isGrid ? 'w-full aspect-video' : 'flex-none w-64 aspect-video hover:z-50'}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => {
        if (video.isFolder && !video.resumeEpisode) {
          onInfo(video);
        } else if (!isHovered) {
          onPlay(resolvePlayTarget(video));
        }
      }}
    >
      {/* Base Card (Underneath) */}
      <div className="w-full h-full bg-gray-800 rounded-md overflow-hidden relative">
        {cardImageSrc ? (
          <img src={cardImageSrc} alt={video.meta?.title || video.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gray-700 flex items-center justify-center p-4 text-center font-bebas text-gray-300">
            {getDisplayTitle(video)}
          </div>
        )}
        <ThumbnailTitle title={getDisplayTitle(video)} imageSrc={cardImageSrc} />
        {watched && watchedIndicatorMode === 'always' && (
          <WatchedEyeIndicator
            imageSrc={cardImageSrc}
            mode="always"
            hovered
          />
        )}
        {/* Progress Bar */}
        {progress !== undefined && progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-600">
            <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      {/* Expanded Hover Card (Jawlet) */}
      <AnimatePresence>
        {allowHover && isHovered && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: isGrid ? 1.15 : 1.3 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={
              isGrid
                ? 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[115%] bg-[#181818] rounded-md shadow-[0_10px_40px_rgba(0,0,0,0.9)] z-[600] overflow-hidden border border-gray-700/50'
                : 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[25%] w-full bg-[#181818] rounded-md shadow-[0_10px_40px_rgba(0,0,0,0.8)] z-[100] overflow-hidden border border-gray-700/50'
            }
            style={{ transformOrigin: isGrid ? 'center center' : 'bottom center' }}
          >
            <div className="w-full aspect-video relative cursor-pointer" onClick={(e) => { e.stopPropagation(); onPlay(playTarget); }}>
              {useStaticPreview ? (
                (!useLocalOnly && tmdb?.backdrop) || video.thumbnail ? (
                  <img
                    src={(!useLocalOnly && tmdb?.backdrop) || video.thumbnail || ''}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-800 flex items-center justify-center p-4 text-center font-bebas text-gray-300">
                    {getDisplayTitle(video)}
                  </div>
                )
              ) : (
                <video
                  src={`file:///${playTarget.path.replace(/\\/g, '/')}`}
                  autoPlay
                  muted
                  loop
                  className="w-full h-full object-cover"
                  onLoadedMetadata={(e) => {
                    const v = e.target as HTMLVideoElement;
                    const dur = playTarget.duration ?? video.duration;
                    if (dur) v.currentTime = Math.floor(dur / 2);
                  }}
                />
              )}
              {watched && watchedIndicatorMode === 'hover' && (
                <WatchedEyeIndicator
                  imageSrc={jawletPreviewSrc}
                  mode="hover"
                  hovered
                />
              )}
              <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition">
                <Play className="w-10 h-10 text-white fill-white drop-shadow-lg" />
              </div>
            </div>
            
            <div className="p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <div className="flex gap-2">
                  <button onClick={(e) => { e.stopPropagation(); onPlay(playTarget); }} className="w-8 h-8 bg-white rounded-full flex items-center justify-center hover:bg-gray-200 transition">
                    <Play className="w-4 h-4 fill-black text-black ml-0.5" />
                  </button>
                  <VideoCardListButton
                    video={video}
                    activeProfileId={activeProfileId}
                    onOpenChange={setListPickerOpen}
                  />
                </div>
                <button onClick={(e) => { e.stopPropagation(); onInfo(video); }} className="w-8 h-8 bg-transparent border-2 border-gray-500 rounded-full flex items-center justify-center hover:border-white transition text-white">
                  <ChevronRight className="w-4 h-4 rotate-90" />
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-white font-semibold flex-wrap">
                {!useLocalOnly && tmdb && (
                  <span className="text-green-400">{tmdbMatchLabel(tmdb)}</span>
                )}
                {(video.meta?.year || (!useLocalOnly && tmdb?.year)) && (
                  <span className="text-gray-400">{video.meta?.year || (!useLocalOnly ? tmdb?.year : undefined)}</span>
                )}
                {video.isFolder && video.folderFiles && video.folderFiles.length > 0 && (
                  <span className="text-gray-400">{video.folderFiles.length} Episodes</span>
                )}
                {video.isFolder && folderTotalRuntime > 0 && (
                  <span className="text-gray-400">{formatDurationShort(folderTotalRuntime)}</span>
                )}
                {!video.isFolder && video.duration != null && video.duration > 0 && (
                  <span className="text-gray-400">{formatDurationShort(video.duration)}</span>
                )}
                <span className="border border-gray-600 px-1 rounded text-gray-400">HD</span>
              </div>
              <div className="text-xs text-white font-bold line-clamp-2">
                {getDisplayTitle(video)}
              </div>
              {(video.meta?.genre || (!useLocalOnly && tmdb?.synopsis) || video.meta?.description) && (
                <div className="text-xs text-gray-400 line-clamp-3">
                  {(useLocalOnly ? video.meta?.description : (tmdb?.synopsis || video.meta?.description)) || video.meta?.genre}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Top10RankNumber({ rank }: { rank: number }) {
  const isOne = rank === 1;
  const isTen = rank >= 10;

  return (
    <div
      aria-hidden
      className="absolute inset-y-0 z-0 flex items-end pointer-events-none select-none"
      style={{ left: isOne ? -14 : isTen ? -18 : 0 }}
    >
      <span
        className="font-bebas tracking-tighter block"
        style={{
          marginBottom: 4,
          fontSize: isTen ? '6.75rem' : '7.25rem',
          lineHeight: 0.78,
          letterSpacing: isTen ? '-0.06em' : undefined,
          color: '#141414',
          WebkitTextStroke: '2px #737373',
          paintOrder: 'stroke fill',
        }}
      >
        {rank}
      </span>
    </div>
  );
}

/** Left inset for the poster so the rank peeks out to the left (Netflix-style overlap). */
function top10CardInset(rank: number): number {
  if (rank === 1) return 28;
  if (rank >= 10) return 58;
  return 40;
}

// --- Content Row (Carousel) ---
export function ContentRow({
  title,
  videos,
  onPlay,
  onInfo,
  progresses = {},
  isTop10 = false,
  expandable = false,
  activeProfileId,
  watchedIndicatorMode = 'always',
  mediaType: mediaTypeProp,
  userListId,
  bulkAddCatalog,
}: {
  title: string;
  videos: LocalFile[];
  onPlay: (v: LocalFile) => void;
  onInfo: (v: LocalFile) => void;
  progresses?: Record<string, number>;
  isTop10?: boolean;
  expandable?: boolean;
  activeProfileId?: string | null;
  watchedIndicatorMode?: Settings['watchedIndicatorMode'];
  mediaType?: 'movie' | 'tv';
  userListId?: string;
  bulkAddCatalog?: LocalFile[];
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [titleHovered, setTitleHovered] = useState(false);

  const handleScroll = () => {
    if (rowRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = rowRef.current;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 5); // 5px buffer
    }
  };

  useEffect(() => {
    handleScroll();
    window.addEventListener('resize', handleScroll);
    return () => window.removeEventListener('resize', handleScroll);
  }, [videos]);

  const scroll = (direction: 'left' | 'right') => {
    if (rowRef.current) {
      const { scrollLeft, clientWidth } = rowRef.current;
      const scrollAmount = direction === 'left' ? scrollLeft - clientWidth * 0.75 : scrollLeft + clientWidth * 0.75;
      rowRef.current.scrollTo({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  if (videos.length === 0 && !userListId) return null;

  const mediaType: 'movie' | 'tv' | undefined =
    mediaTypeProp ?? (title === 'Movies' ? 'movie' : title === 'Series' ? 'tv' : undefined);

  return (
    <div className="mb-8 relative group z-20 hover:z-50">
      <div
        className={`relative z-10 flex items-center gap-2 mb-2 px-10 py-2 w-full ${expandable ? 'cursor-pointer' : ''}`}
        onMouseEnter={() => setTitleHovered(true)}
        onMouseLeave={() => setTitleHovered(false)}
        onClick={() => expandable && setShowGrid(true)}
      >
        <h2 className={`text-xl md:text-2xl font-bold transition ${titleHovered && expandable ? 'text-white' : 'text-gray-200'}`}>
          {title}
        </h2>
        {expandable && (
          <ChevronRight
            className={`w-5 h-5 shrink-0 text-white transition-all duration-200 ${
              titleHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'
            }`}
          />
        )}
      </div>

      {showGrid && userListId && activeProfileId && bulkAddCatalog && (
        <UserListGridModal
          profileId={activeProfileId}
          listId={userListId}
          catalog={bulkAddCatalog}
          onClose={() => setShowGrid(false)}
          onPlay={(v) => { setShowGrid(false); onPlay(v); }}
          onInfo={(v) => { setShowGrid(false); onInfo(v); }}
          onListDeleted={() => setShowGrid(false)}
          progresses={progresses}
          watchedIndicatorMode={watchedIndicatorMode}
        />
      )}
      {showGrid && !(userListId && activeProfileId && bulkAddCatalog) && (
        <GridViewModal
          title={title}
          videos={videos}
          onClose={() => setShowGrid(false)}
          onPlay={(v) => { setShowGrid(false); onPlay(v); }}
          onInfo={(v) => { setShowGrid(false); onInfo(v); }}
          progresses={progresses}
          sortable={expandable}
          showRandomPlay={expandable}
          activeProfileId={activeProfileId}
          mediaType={mediaType}
          watchedIndicatorMode={watchedIndicatorMode}
        />
      )}
      
      {/* Left Arrow */}
      {showLeftArrow && (
        <div 
          className="absolute left-0 top-[10%] bottom-[10%] w-10 md:w-12 bg-black/50 z-40 flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition hover:bg-black/80 rounded-r-md pointer-events-auto"
          onClick={() => scroll('left')}
        >
          <ChevronLeft className="w-8 h-8 text-white hover:scale-125 transition-transform" />
        </div>
      )}

      {/* Right Arrow */}
      {showRightArrow && (
        <div 
          className="absolute right-0 top-[10%] bottom-[10%] w-10 md:w-12 bg-black/50 z-40 flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition hover:bg-black/80 rounded-l-md pointer-events-auto"
          onClick={() => scroll('right')}
        >
          <ChevronRight className="w-8 h-8 text-white hover:scale-125 transition-transform" />
        </div>
      )}

      <div 
        ref={rowRef}
        onScroll={handleScroll}
        className={`relative z-20 flex overflow-x-auto overflow-y-hidden px-10 pt-32 pb-16 -mt-28 hide-scrollbar scroll-smooth pointer-events-none ${isTop10 ? 'gap-5' : 'gap-2'}`}
      >
        {videos.map((video, i) => {
          const rank = i + 1;
          return (
            <div
              key={`${video.path}-${i}`}
              className="relative flex items-end flex-shrink-0 hover:z-50 pointer-events-auto"
            >
              {isTop10 && <Top10RankNumber rank={rank} />}
              <div
                className={isTop10 ? 'relative z-10 flex-shrink-0' : ''}
                style={isTop10 ? { marginLeft: top10CardInset(rank) } : undefined}
              >
                <VideoCard
                  video={video}
                  onPlay={onPlay}
                  onInfo={onInfo}
                  progress={cardProgress(video, progresses)}
                  watched={getVideoWatched(video, progresses, activeProfileId)}
                  watchedIndicatorMode={watchedIndicatorMode}
                  activeProfileId={activeProfileId}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
