import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  enrichLibraryInBackground,
  mergeEnrichedFiles,
  buildOptimizedEnrichQueue,
} from './utils/libraryLoader';
import { scanAllFolders, diffLibrary, mergeLibrarySync, pruneRemovedPaths } from './utils/librarySync';
import { runInitialScanOnce, resetScanSession } from './utils/scanSession';
import { Play, Info, FolderSearch, Settings as SettingsIcon, Search, History, Volume2, VolumeX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SettingsModal } from './components/SettingsModal';
import { ContentRow, DetailModal } from './components/NetflixUI';
import type { LocalFile } from './components/NetflixUI';
import {
  applyMediaOverride,
  clearMediaOverride,
  saveMediaOverride,
  type MediaOverride,
} from './utils/mediaOverrides';
import { resolveFileMeta } from './utils/metadata';
import { getPlayerDisplayTitle } from './utils/displayTitle';
import { getAdjacentEpisodes } from './utils/episodeNavigation';
import { resolveEpisodeNumbers, parseEpisodeFromText } from './utils/episodeParsing';
import { getShowSkipSettings } from './utils/showSkip';
import { loadSettings, saveSettings } from './utils/settings';
import { StartupScreen } from './components/StartupScreen';
import { ProfilesScreen } from './components/ProfilesScreen';
import { SearchOverlay } from './components/SearchOverlay';
import {
  buildSeriesFolders,
  buildContinueWatchingAll,
  buildContinueWatchingMovies,
  buildContinueWatchingSeries,
  buildTop10,
  buildSearchCatalog,
  buildHeroCatalog,
  buildGenreRows,
  getSeriesRoot,
  getSeriesRootFromFile,
  setTvParentFolders,
  resolvePlayTarget,
  resolveShowDetailTarget,
} from './utils/grouping';
import {
  clearTmdbCaches,
  getTMDBLookupOptions,
  invalidateTmdbForVideo,
  invalidateTmdbSession,
  prefetchTMDBCatalog,
  prefetchTMDBDetailsCatalog,
  tmdbArtwork,
  getCachedForVideo,
} from './utils/tmdb';
import { useTMDB } from './hooks/useTMDB';
import { isTmdbDisabled } from './utils/mediaOverrides';
import { setManualWatched } from './utils/watched';
import {
  dismissUpdateNotice,
  isUpdateNoticeDismissed,
  scheduleAppUpdateCheck,
  type AppUpdateInfo,
} from './utils/appUpdate';
import { UpdateAvailableNotice } from './components/UpdateAvailableNotice';
import { resolveAppVersion } from './utils/appVersion';
import { useUserLists } from './hooks/useUserLists';
import { pruneLists, resolveListVideos } from './utils/userLists';
import { ManageListsModal } from './components/ManageListsModal';
import { WatchHistoryOverlay } from './components/WatchHistoryOverlay';
import { cancelEnrich } from './utils/enrichCancel';
import { releaseVideoForPath } from './utils/thumbnail';
import { appendWatchHistory, episodeCodeFromFile } from './utils/watchHistory';
import { OnlineWatchView } from './components/OnlineWatchView';
import kudLogo from './assets/logo.png';

function WatchOnlineIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect
        x="2.5"
        y="5.5"
        width="19"
        height="13"
        rx="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path d="M10 9.15v5.7L15.4 12 10 9.15z" fill="currentColor" />
    </svg>
  );
}

export default function App() {
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  
  const [activeTab, setActiveTab] = useState<'home' | 'tv' | 'movies' | 'online'>('home');

  const [files, setFiles] = useState<LocalFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [librarySyncing, setLibrarySyncing] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<LocalFile | null>(null);
  const playingVideoRef = useRef<LocalFile | null>(null);
  const [infoVideo, setInfoVideo] = useState<LocalFile | null>(null);
  const [infoInitialSubfolder, setInfoInitialSubfolder] = useState<string | undefined>(undefined);
  const [showStartup, setShowStartup] = useState(true);
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'general' | 'library' | 'personalization' | 'profiles' | 'advanced'>('general');
  const [settings, setSettings] = useState(loadSettings);

  const enrichGenRef = useRef(0);
  const tmdbPrefetchGenRef = useRef(0);
  const prevTmdbKeyRef = useRef(settings.customTmdbApiKey);
  const activeProfileRef = useRef(activeProfile);
  const filesRef = useRef(files);
  activeProfileRef.current = activeProfile;
  filesRef.current = files;
  const [progresses, setProgresses] = useState<Record<string, number>>({});
  const [overrideTick, setOverrideTick] = useState(0);
  const [watchedTick, setWatchedTick] = useState(0);
  const [tmdbCacheTick, setTmdbCacheTick] = useState(0);
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateNoticeDismissed, setUpdateNoticeDismissed] = useState(false);
  const [showManageLists, setShowManageLists] = useState(false);
  const [manageListsKind, setManageListsKind] = useState<'movie' | 'tv'>('movie');

  const userLists = useUserLists(activeProfile);

  useEffect(() => {
    let cancelled = false;
    void resolveAppVersion().then((version) => {
      if (cancelled) return;
      scheduleAppUpdateCheck(version, (info) => {
        if (!cancelled) setAppUpdateInfo(info);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const showUpdateNotice =
    !showStartup &&
    !playingVideo &&
    appUpdateInfo?.status === 'update' &&
    appUpdateInfo.latestVersion &&
    !updateNoticeDismissed &&
    !isUpdateNoticeDismissed(appUpdateInfo.latestVersion);

  const handleDismissUpdateNotice = useCallback(() => {
    if (appUpdateInfo?.status === 'update' && appUpdateInfo.latestVersion) {
      dismissUpdateNotice(appUpdateInfo.latestVersion);
    }
    setUpdateNoticeDismissed(true);
  }, [appUpdateInfo]);

  const handleWatchedChange = useCallback(() => {
    setWatchedTick((t) => t + 1);
  }, []);

  const getInProgressPaths = (profileId: string | null): Set<string> => {
    if (!profileId) return new Set();
    try {
      const prog = JSON.parse(localStorage.getItem(`netflix_progress_${profileId}`) || '{}') as Record<string, number>;
      return new Set(Object.entries(prog).filter(([, v]) => v > 5).map(([p]) => p));
    } catch {
      return new Set();
    }
  };

  useEffect(() => {
    if (activeProfile) {
      const savedProg = localStorage.getItem(`netflix_progress_${activeProfile}`);
      if (savedProg) {
        setProgresses(JSON.parse(savedProg));
      } else {
        setProgresses({});
      }
    }
  }, [activeProfile]);

  // Enrich continue-watching episode thumbnails when a profile is selected
  useEffect(() => {
    if (!activeProfile) return;
    const paths = getInProgressPaths(activeProfile);
    if (paths.size === 0) return;

    const queue = filesRef.current
      .filter((f) => f.category && paths.has(f.path) && (!f.thumbnail || !f.duration))
      .map((f) => ({
        file: {
          name: f.name,
          path: f.path,
          relativePath: f.relativePath,
          folderName: f.folderName,
          localPoster: f.localPoster,
          localFanart: f.localFanart,
          localNfoContent: f.localNfoContent,
          mtimeMs: f.dateModified,
        },
        category: f.category as 'movie' | 'tv',
      }));
    if (queue.length === 0) return;

    const gen = ++enrichGenRef.current;
    enrichLibraryInBackground(queue, (batch) => {
      if (gen !== enrichGenRef.current) return;
      setFiles((prev) => mergeEnrichedFiles(prev, batch));
    }).catch((err) => console.error('Priority enrich failed:', err));
  }, [activeProfile]);

  const tryAutoSignIn = () => {
    if (!settings.skipProfilePicker || !settings.defaultProfileId) return false;
    try {
      const profiles = JSON.parse(localStorage.getItem('netflix_profiles') || '[]');
      if (profiles.some((p: { id: string }) => p.id === settings.defaultProfileId)) {
        setActiveProfile(settings.defaultProfileId);
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  };

  const handleStartupComplete = () => {
    setShowStartup(false);
    tryAutoSignIn();
  };

  // Apply Settings to CSS Variables
  useEffect(() => {
    document.documentElement.style.setProperty('--theme-accent', settings.accentColor);
    document.documentElement.style.setProperty('--theme-overlay-opacity', settings.overlayOpacity.toString());
    
    if (settings.wallpaperPath) {
      const wp = settings.wallpaperPath;
      const formattedPath = wp.startsWith('file://')
        ? wp
        : `file:///${wp.replace(/\\/g, '/')}`;
      document.documentElement.style.setProperty('--theme-wallpaper', `url('${formattedPath}')`);
    } else {
      document.documentElement.style.removeProperty('--theme-wallpaper');
    }
    
    if (prevTmdbKeyRef.current !== settings.customTmdbApiKey) {
      clearTmdbCaches();
      invalidateTmdbSession();
      setTmdbCacheTick((t) => t + 1);
      prevTmdbKeyRef.current = settings.customTmdbApiKey;
    }

    saveSettings(settings);
    setTvParentFolders(settings.tvParentFolders);
    window.electronAPI?.setAppIcon?.('default');
    window.electronAPI?.setDiscordRpcEnabled?.(settings.discordRpcEnabled ?? true);
    window.electronAPI?.setDiscordRpcActivityStyle?.(settings.discordActivityStyle ?? 'watching');
  }, [settings]);

  useEffect(() => {
    if (settings.watchOnlineNav === 'hidden' && activeTab === 'online') {
      setActiveTab('home');
    }
  }, [settings.watchOnlineNav, activeTab]);

  useEffect(() => {
    window.electronAPI?.updateLibraryWatch?.([
      ...settings.movieFolders,
      ...settings.tvFolders,
      ...(settings.animeFolders || []),
    ]);
  }, [settings.movieFolders, settings.tvFolders, settings.animeFolders]);

  const refreshVideoFromLibrary = (file: LocalFile): LocalFile => {
    const meta = resolveFileMeta(
      {
        name: file.name,
        path: file.path,
        localNfoContent: file.localNfoContent,
      },
      file.category,
    );
    const { tmdbDisabled: _removed, ...rest } = file;
    return applyMediaOverride({ ...rest, meta });
  };

  const handleUpdateVideo = (path: string, override: MediaOverride) => {
    const previous = files.find((f) => f.path === path) ?? infoVideo;
    const prevLookup = previous ? getTMDBLookupOptions(previous) : undefined;

    saveMediaOverride(path, override);
    setOverrideTick((t) => t + 1);

    const affectsTmdb =
      'tmdbId' in override ||
      'title' in override ||
      'year' in override ||
      'disableTmdb' in override;

    setFiles((prev) =>
      prev.map((f) => {
        if (f.path !== path) return f;
        const updated = applyMediaOverride(f);
        invalidateTmdbForVideo(updated, prevLookup);
        return updated;
      }),
    );

    setInfoVideo((prev) => {
      if (prev?.path !== path) return prev;
      const updated = applyMediaOverride(prev);
      invalidateTmdbForVideo(updated, prevLookup);
      return updated;
    });

    if (affectsTmdb) setTmdbCacheTick((t) => t + 1);
  };

  const handleResetVideo = (path: string) => {
    const previous = files.find((f) => f.path === path) ?? infoVideo;
    const prevLookup = previous ? getTMDBLookupOptions(previous) : undefined;

    clearMediaOverride(path);
    setOverrideTick((t) => t + 1);
    setTmdbCacheTick((t) => t + 1);

    const resetOne = (f: LocalFile): LocalFile => {
      if (f.path !== path) return f;
      const refreshed = refreshVideoFromLibrary(f);
      invalidateTmdbForVideo(refreshed, prevLookup);
      return refreshed;
    };

    setFiles((prev) => prev.map(resetOne));
    setInfoVideo((prev) => (prev?.path === path ? resetOne(prev) : prev));
  };

  const handleEpisodeEnriched = useCallback((batch: LocalFile[]) => {
    setFiles((prev) => mergeEnrichedFiles(prev, batch));
    setInfoVideo((prev) => {
      if (!prev?.isFolder || !prev.folderFiles) return prev;
      const updates = new Map(batch.map((f) => [f.path, f]));
      const folderFiles = prev.folderFiles.map((f) => updates.get(f.path) ?? f);
      return { ...prev, folderFiles };
    });
  }, []);

  const scanLibrary = useCallback(async (incremental = false) => {
    const hasFolders = settings.movieFolders.length > 0 || settings.tvFolders.length > 0;
    if (!hasFolders) return;

    if (!window.electronAPI) {
      return;
    }

    const execute = async () => {
      setLoading(true);
      setLibrarySyncing(true);
      const gen = ++enrichGenRef.current;

      try {
        const { basicFiles, enrichQueue } = await scanAllFolders(settings);
        const priorityPaths = getInProgressPaths(activeProfileRef.current);

        if (incremental) {
          setFiles((prev) => {
            const diff = diffLibrary(prev, basicFiles);
            if (diff.added.length === 0 && diff.removedPaths.length === 0) {
              return prev;
            }
            pruneRemovedPaths(diff.removedPaths);
            const merged = mergeLibrarySync(prev, diff.added, diff.removedPaths);
            const addedPaths = new Set(diff.added.map((f) => f.path));
            const newEnrichQueue = enrichQueue.filter((item) => addedPaths.has(item.file.path));
            const optimized = buildOptimizedEnrichQueue(newEnrichQueue, priorityPaths, merged);
            if (optimized.length > 0) {
              enrichLibraryInBackground(optimized, (batch) => {
                if (gen !== enrichGenRef.current) return;
                setFiles((current) => mergeEnrichedFiles(current, batch));
              }).catch((err) => console.error('Background enrich failed:', err));
            }
            return merged;
          });
        } else {
          setFiles(basicFiles);
          const optimized = buildOptimizedEnrichQueue(enrichQueue, priorityPaths, basicFiles);
          enrichLibraryInBackground(optimized, (batch) => {
            if (gen !== enrichGenRef.current) return;
            setFiles((prev) => mergeEnrichedFiles(prev, batch));
          }).catch((err) => console.error('Background enrich failed:', err));
        }
      } catch (err) {
        console.error(err);
        if (!incremental) setFiles([]);
      } finally {
        setLoading(false);
        setLibrarySyncing(false);
      }
    };

    if (incremental) return execute();
    const folderKey = settings.movieFolders.join('\0') + '\0' + settings.tvFolders.join('\0') + '\0' + (settings.animeFolders || []).join('\0');
    return runInitialScanOnce(folderKey, execute);
  }, [settings]);

  const openLibrarySettings = () => {
    setSettingsTab('library');
    setShowSettings(true);
  };

  const hasLibrary = settings.movieFolders.length > 0 || settings.tvFolders.length > 0 || (settings.animeFolders?.length ?? 0) > 0;
  const libraryFolderKey = settings.movieFolders.join('\0') + '\0' + settings.tvFolders.join('\0') + '\0' + (settings.animeFolders || []).join('\0');
  const loadedLibraryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasLibrary) {
      setFiles([]);
      loadedLibraryKeyRef.current = null;
      resetScanSession();
      return;
    }

    // Scan once per folder configuration; start before profile pick so thumbnails load in background
    if (loadedLibraryKeyRef.current === libraryFolderKey) return;
    loadedLibraryKeyRef.current = libraryFolderKey;
    enrichGenRef.current += 1;
    scanLibrary(false);
  }, [libraryFolderKey, hasLibrary, scanLibrary]);

  useEffect(() => {
    if (!window.electronAPI?.onLibraryChanged) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    return window.electronAPI.onLibraryChanged(() => {
      if (!settings.autoSyncLibrary) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => scanLibrary(true), 500);
    });
  }, [settings.autoSyncLibrary, scanLibrary]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onLibraryPathsRemoved) return;
    return api.onLibraryPathsRemoved((paths) => {
      if (!paths?.length) return;
      cancelEnrich(paths);
      for (const p of paths) releaseVideoForPath(p);
    });
  }, []);

  const playInExternal = (video: LocalFile) => {
    if (settings.externalPlayerPath && window.electronAPI?.playInExternalPlayer) {
      window.electronAPI.playInExternalPlayer(settings.externalPlayerPath, video.path);
      return true;
    }
    return false;
  };


  const episodeLabel = (video: LocalFile) => {
    const parsed = resolveEpisodeNumbers(video.name, video.relativePath);
    if (parsed) {
      return `S${parsed.season}:E${parsed.episode}`;
    }
    const epNum = parseEpisodeFromText(video.name);
    if (epNum != null) {
      return `Episode ${epNum}`;
    }
    return undefined;
  };

  const buildSession = (video: LocalFile, opts?: { startAt?: 'progress' | 'beginning' }): PlayerSession | null => {
    if (!activeProfile) return null;
    const progress = JSON.parse(localStorage.getItem(`netflix_progress_${activeProfile}`) || '{}');
    let startTime = opts?.startAt === 'beginning' ? 0 : (progress[video.path] || 0);
    // Restart finished items from the beginning
    if (video.duration && startTime > video.duration - 30) startTime = 0;
    const allKnown = filesRef.current.length > 0 ? filesRef.current : files;
    const { prev, next } = getAdjacentEpisodes(allKnown, video);
    const { outroSkipSeconds } = getShowSkipSettings(video);

    const httpsArt = (...urls: (string | null | undefined)[]): string | undefined => {
      for (const c of urls) {
        if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c;
      }
      return undefined;
    };

    const resolveOnlineImage = (target?: LocalFile): string | undefined => {
      if (!target) return undefined;
      const cached = getCachedForVideo(target);
      const art = tmdbArtwork(cached, target);
      return httpsArt(cached?.poster, cached?.backdrop, art, target.meta?.poster, target.thumbnail);
    };

    let onlineThumbnail = resolveOnlineImage(video);

    if (!onlineThumbnail) {
      const root = getSeriesRootFromFile(video) || getSeriesRoot(video.relativePath);
      if (root) {
        const parent = allKnown.find(
          (f) => f.isFolder && (f.relativePath === root || f.folderName === root || f.path === `folder://${root}`)
        );
        onlineThumbnail = resolveOnlineImage(parent);
      }
    }

    return {
      path: video.path,
      title: getPlayerDisplayTitle(video),
      subtitle: episodeLabel(video),
      thumbnail: onlineThumbnail,
      profileId: activeProfile,
      startTime,
      outroSkipSeconds: outroSkipSeconds > 0 ? outroSkipSeconds : undefined,
      prev: prev
        ? {
            path: prev.path,
            title: getPlayerDisplayTitle(prev),
            subtitle: episodeLabel(prev),
            thumbnail: resolveOnlineImage(prev) || onlineThumbnail,
          }
        : null,
      next: next
        ? {
            path: next.path,
            title: getPlayerDisplayTitle(next),
            subtitle: episodeLabel(next),
            thumbnail: resolveOnlineImage(next) || onlineThumbnail,
          }
        : null,
      appName: settings.appName,
    };
  };

  const handlePlayVideo = (video: LocalFile, opts?: { startAt?: 'progress' | 'beginning' }) => {
    const target = resolvePlayTarget(video);
    if (activeProfile) {
      const counts = JSON.parse(localStorage.getItem(`netflix_playcounts_${activeProfile}`) || '{}');
      counts[target.path] = (counts[target.path] || 0) + 1;
      localStorage.setItem(`netflix_playcounts_${activeProfile}`, JSON.stringify(counts));
    }

    if (settings.useExternalPlayer && playInExternal(target)) return;

    const session = buildSession(target, opts);
    if (!session || !window.electronAPI?.playerStart) return;
    playingVideoRef.current = target;
    setPlayingVideo(target);
    window.electronAPI.playerStart(session);
  };

  const handlePlayOnlineVideo = (video: OnlineVideo) => {
    const session: PlayerSession = {
      path: video.url,
      title: video.title,
      subtitle: video.channel || 'YouTube',
      thumbnail: video.thumbnail || undefined,
      profileId: activeProfile || '',
      startTime: 0,
      prev: null,
      next: null,
      appName: settings.appName,
    };

    if (!window.electronAPI?.playerStart) return;

    const onlineFile: LocalFile = {
      name: video.title,
      path: video.url,
      meta: {
        title: video.title,
        description: video.description,
        poster: video.thumbnail || undefined,
      },
      thumbnail: video.thumbnail || undefined,
      duration: video.duration,
    };

    playingVideoRef.current = onlineFile;
    setPlayingVideo(onlineFile);
    window.electronAPI.playerStart(session);
  };

  const handleOpenInfo = useCallback(
    (video: LocalFile) => {
      const resolved = resolveShowDetailTarget(files, video);
      if (resolved) {
        setInfoVideo(resolved.show);
        setInfoInitialSubfolder(resolved.seasonKey);
      } else {
        setInfoVideo(video);
        setInfoInitialSubfolder(undefined);
      }
    },
    [files],
  );

  const closeInfo = useCallback(() => {
    setInfoVideo(null);
    setInfoInitialSubfolder(undefined);
  }, []);

  // Keep handlers fresh for the IPC listeners below without re-subscribing
  const playerHandlersRef = useRef({ handlePlayVideo, files });
  playerHandlersRef.current = { handlePlayVideo, files };

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPlayerExited) return;

    const offExited = api.onPlayerExited((payload) => {
      const watchedFile = playingVideoRef.current;
      playingVideoRef.current = null;
      setPlayingVideo(null);
      if (activeProfile) {
        setProgresses(JSON.parse(localStorage.getItem(`netflix_progress_${activeProfile}`) || '{}'));
        if (payload?.duration && payload.duration > 0 && payload.position / payload.duration >= 0.9) {
          setManualWatched(activeProfile, payload.path, true);
          setWatchedTick((t) => t + 1);
        }
        if (payload && watchedFile && payload.path === watchedFile.path) {
          void appendWatchHistory(activeProfile, watchedFile, payload, episodeCodeFromFile(watchedFile));
        }
      }
    });

    const norm = (p: string) => {
      try {
        return decodeURIComponent(p).replace(/\\/g, '/').toLowerCase();
      } catch {
        return p.replace(/\\/g, '/').toLowerCase();
      }
    };

    const offNext = api.onPlayerRequestNext((targetOrCurrentPath) => {
      if (!targetOrCurrentPath) return;
      const { files: list, handlePlayVideo: play } = playerHandlersRef.current;
      const allKnown = list.length > 0 ? list : filesRef.current;
      const matched = allKnown.find((f) => norm(f.path) === norm(targetOrCurrentPath));
      const currentPlaying = playingVideoRef.current;

      if (matched && (!currentPlaying || norm(matched.path) !== norm(currentPlaying.path))) {
        play(matched, { startAt: 'beginning' });
      } else {
        const reference = matched || currentPlaying;
        const { next } = getAdjacentEpisodes(allKnown, reference ?? null);
        if (next) play(next, { startAt: 'beginning' });
      }
    });

    const offPrev = api.onPlayerRequestPrev?.((targetOrCurrentPath) => {
      if (!targetOrCurrentPath) return;
      const { files: list, handlePlayVideo: play } = playerHandlersRef.current;
      const allKnown = list.length > 0 ? list : filesRef.current;
      const matched = allKnown.find((f) => norm(f.path) === norm(targetOrCurrentPath));
      const currentPlaying = playingVideoRef.current;

      if (matched && (!currentPlaying || norm(matched.path) !== norm(currentPlaying.path))) {
        play(matched, { startAt: 'beginning' });
      } else {
        const reference = matched || currentPlaying;
        const { prev } = getAdjacentEpisodes(allKnown, reference ?? null);
        if (prev) play(prev, { startAt: 'beginning' });
      }
    });

    return () => {
      offExited();
      offNext();
      offPrev?.();
    };
  }, [activeProfile]);

  // Grouping for rows
  const {
    movies,
    folders,
    animeCatalog,
    top10,
    continueWatchingAll,
    continueWatchingMovies,
    continueWatchingTv,
    movieGenreRows,
    tvGenreRows,
    searchCatalog,
    heroCatalog,
  } = useMemo(() => {
    const shows = files.filter(f => f.category === 'tv' || f.category === 'anime');
    const movies = files.filter(f => f.category === 'movie');
    const folders = buildSeriesFolders(shows);
    const animeShows = folders.filter(f => f.category === 'anime' || f.folderFiles?.some(ep => ep.category === 'anime'));
    const animeMovies = movies.filter(f => f.category === 'anime');
    const animeCatalog = [...animeShows, ...animeMovies];

    const playCounts = JSON.parse(localStorage.getItem(`netflix_playcounts_${activeProfile}`) || '{}');
    const top10 = buildTop10(movies, shows, playCounts, folders);
    const continueWatchingMovies = buildContinueWatchingMovies(movies, progresses);
    const continueWatchingTv = buildContinueWatchingSeries(shows, progresses, folders);
    const continueWatchingAll = buildContinueWatchingAll(movies, shows, progresses, folders);
    const movieGenreRows = buildGenreRows(movies);
    const tvGenreRows = buildGenreRows(folders);
    const searchCatalog = buildSearchCatalog(movies, folders);
    const heroCatalog = buildHeroCatalog(movies, folders);

    return {
      movies,
      folders,
      animeCatalog,
      top10,
      continueWatchingAll,
      continueWatchingMovies,
      continueWatchingTv,
      movieGenreRows,
      tvGenreRows,
      searchCatalog,
      heroCatalog,
    };
  }, [files, progresses, activeProfile, overrideTick, tmdbCacheTick, settings.tvParentFolders]);

  const { movieListRows, tvListRows } = useMemo(() => {
    const movieCatalog = movies;
    const tvCatalog = folders;
    const movieListRows = userLists
      .filter((l) => l.kind === 'movie')
      .map((list) => ({ list, videos: resolveListVideos(list, movieCatalog) }));
    const tvListRows = userLists
      .filter((l) => l.kind === 'tv')
      .map((list) => ({ list, videos: resolveListVideos(list, tvCatalog) }));
    return { movieListRows, tvListRows };
  }, [userLists, movies, folders]);

  useEffect(() => {
    if (!activeProfile) return;
    const valid = new Set([
      ...movies.map((m) => m.path),
      ...folders.map((f) => f.path),
    ]);
    pruneLists(activeProfile, valid);
  }, [activeProfile, movies, folders]);

  // Dynamic Hero Banner
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [delayOver, setDelayOver] = useState(false);
  const [isHeroMuted, setIsHeroMuted] = useState(true);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  
  const featured = heroCatalog.length > 0 ? heroCatalog[featuredIndex % heroCatalog.length] : null;
  const featuredLocalOnly = isTmdbDisabled(featured);
  const featuredTmdb = useTMDB(featured);
  const featuredPlayTarget = featured ? resolvePlayTarget(featured) : null;
  const featuredImageSrc = featured
    ? (tmdbArtwork(featuredLocalOnly ? null : featuredTmdb, featured) || featured.localFanart || featured.localPoster || featured.thumbnail)
    : undefined;

  useEffect(() => {
    if (files.length === 0 || loading || librarySyncing) return;

    const movies = files.filter((f) => f.category === 'movie');
    const seriesFolders = buildSeriesFolders(files.filter((f) => f.category === 'tv' || f.category === 'anime'));
    const priority = [...heroCatalog, ...top10, ...continueWatchingAll];
    const gen = ++tmdbPrefetchGenRef.current;

    const timer = setTimeout(async () => {
      if (gen !== tmdbPrefetchGenRef.current) return;
      prefetchTMDBCatalog([...movies, ...seriesFolders], priority, 80);
      await new Promise((r) => setTimeout(r, 4000));
      if (gen !== tmdbPrefetchGenRef.current) return;
      await prefetchTMDBDetailsCatalog([...movies, ...seriesFolders], priority, 40);
      if (gen === tmdbPrefetchGenRef.current) {
        setTmdbCacheTick((t) => t + 1);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [files, libraryFolderKey, loading, librarySyncing, heroCatalog, top10, continueWatchingAll]);

  // 1. Initial 3s delay on image
  useEffect(() => {
    if (!featured) return;
    
    setDelayOver(false);
    setIsVideoPlaying(false);
    
    const t = setTimeout(() => {
      setDelayOver(true);
    }, 3000);
    
    return () => clearTimeout(t);
  }, [featuredIndex, heroCatalog.length, featured?.path]);

  // 2. Play when mounted
  useEffect(() => {
    if (delayOver && heroVideoRef.current) {
      heroVideoRef.current.play().catch(e => {
        console.error("Play failed:", e);
      });
    }
  }, [delayOver]);

  const handleHeroTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    
    // Safety fallback: if video is advancing, it is playing
    if (video.currentTime > 0.1 && !isVideoPlaying) {
      setIsVideoPlaying(true);
    }
    
    if (video.currentTime >= 15) {
      // End of preview
      setDelayOver(false);
      setIsVideoPlaying(false);
      
      // Wait 5s on image, then cycle
      setTimeout(() => {
        setFeaturedIndex((prev) => (prev + 1) % heroCatalog.length);
      }, 5000);
    }
  };


  return (
    // @ts-ignore - zoom works in electron
    <div 
      className="text-white selection:bg-accent selection:text-white pb-20 flex flex-col min-h-screen bg-[#141414] overflow-x-hidden relative" 
      style={{ zoom: settings.uiScale, minHeight: `${100 / settings.uiScale}vh` }}
    >
      
      {/* Startup Screen */}
      {showStartup && (
        <StartupScreen 
          onComplete={handleStartupComplete}
          appName={settings.appName} 
          accentColor={settings.accentColor} 
        />
      )}

      {/* Profiles Screen */}
      {!showStartup && !activeProfile && (
        <ProfilesScreen
          onSelect={setActiveProfile}
          skipProfilePicker={settings.skipProfilePicker}
          defaultProfileId={settings.defaultProfileId}
          onProfileSettingsChange={(update) => setSettings(prev => ({ ...prev, ...update }))}
        />
      )}

      {/* Main App Body (Only render if profile selected) */}
      {activeProfile && (
        <>
          {/* Top Navbar */}
            <nav 
              className="fixed top-0 w-full z-50 bg-gradient-to-b from-black/90 via-black/50 to-transparent px-10 py-4 flex items-center justify-between pointer-events-none transition-all duration-300 origin-top"
              style={{ WebkitAppRegion: 'drag', zoom: 1.15 } as any}
            >
              <div className="flex items-center gap-8" style={{ WebkitAppRegion: 'no-drag' } as any}>
                <div className="flex items-center gap-2.5 pointer-events-auto">
                  <img src={kudLogo} alt="Logo" className="w-7 h-7 rounded-md object-cover shadow-sm drop-shadow-md" />
                  <h1 className="text-accent font-black text-2xl tracking-tighter shadow-black drop-shadow-md">{settings.appName}</h1>
                </div>
                <ul className="hidden md:flex items-center gap-5 text-sm font-semibold text-gray-200 pointer-events-auto">
                  <li onClick={() => { setShowSearch(false); setShowHistory(false); setActiveTab('home'); }} className={`drop-shadow-md cursor-pointer transition ${activeTab === 'home' && !showSearch && !showHistory ? 'text-white' : 'hover:text-gray-300'}`}>Home</li>
                  <li onClick={() => { setShowSearch(false); setShowHistory(false); setActiveTab('tv'); }} className={`drop-shadow-md cursor-pointer transition ${activeTab === 'tv' && !showSearch && !showHistory ? 'text-white' : 'hover:text-gray-300'}`}>TV Shows</li>
                  <li onClick={() => { setShowSearch(false); setShowHistory(false); setActiveTab('movies'); }} className={`drop-shadow-md cursor-pointer transition ${activeTab === 'movies' && !showSearch && !showHistory ? 'text-white' : 'hover:text-gray-300'}`}>Movies</li>
                  {settings.watchOnlineNav !== 'hidden' && (
                    <li>
                      {settings.watchOnlineNav === 'icon' ? (
                        <button
                          type="button"
                          onClick={() => { setShowSearch(false); setShowHistory(false); setActiveTab('online'); }}
                          className={`flex items-center p-0.5 rounded-md transition ${activeTab === 'online' && !showSearch && !showHistory ? 'text-white' : 'text-gray-200 hover:text-gray-300'}`}
                          aria-label="Watch Online"
                          title="Watch Online"
                        >
                          <WatchOnlineIcon className="w-5 h-5" />
                        </button>
                      ) : (
                        <span
                          onClick={() => { setShowSearch(false); setShowHistory(false); setActiveTab('online'); }}
                          className={`drop-shadow-md cursor-pointer transition ${activeTab === 'online' && !showSearch && !showHistory ? 'text-white' : 'hover:text-gray-300'}`}
                        >
                          Watch Online
                        </span>
                      )}
                    </li>
                  )}
                </ul>
              </div>
            
            <div className="pointer-events-auto flex items-center gap-6 pr-40" style={{ WebkitAppRegion: 'no-drag' } as any}>
              <button
                onClick={() => {
                  setShowHistory(false);
                  setShowSearch((s) => !s);
                }}
                className={`flex items-center group relative p-1 hover:bg-white/10 rounded-full transition ${showSearch ? 'bg-white/10' : ''}`}
                aria-label="Search library"
              >
                <Search className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={() => {
                  setShowSearch(false);
                  setShowHistory((h) => !h);
                }}
                className={`flex items-center group relative p-1 hover:bg-white/10 rounded-full transition ${showHistory ? 'bg-white/10' : ''}`}
                aria-label="Watch history"
              >
                <History className="w-5 h-5 text-white" />
              </button>
              {settings.compactLibraryButton ? (
                <button
                  onClick={openLibrarySettings}
                  className="p-2 hover:bg-white/10 rounded-full transition"
                  aria-label={hasLibrary ? 'Manage library' : 'Select library'}
                >
                  <FolderSearch className="w-5 h-5 text-white" />
                </button>
              ) : (
                <div className="flex items-center bg-black/50 border border-white/20 rounded px-2 hover:bg-white/10 transition cursor-pointer" onClick={openLibrarySettings}>
                  <FolderSearch className="w-4 h-4 text-gray-400 mr-2" />
                  <button className="bg-transparent text-xs text-white py-2 outline-none">
                    {hasLibrary ? 'Manage Library' : 'Select Library'}
                  </button>
                </div>
              )}
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 hover:bg-white/10 rounded-full transition"
              >
                <SettingsIcon className="w-5 h-5 text-white" />
              </button>
              {/* Profile Switcher */}
              <button 
                onClick={() => setActiveProfile(null)}
                className="p-1 hover:bg-white/10 rounded transition"
                aria-label="Switch profile"
              >
                <img 
                  src={
                    (() => {
                      const p = JSON.parse(localStorage.getItem('netflix_profiles') || '[]').find((p: any) => p.id === activeProfile);
                      if (!p || p.avatar.includes('api.dicebear.com') || p.avatar.includes('./avatars/avatar')) return './avatars/key1.jpg';
                      return p.avatar;
                    })()
                  } 
                  className="w-8 h-8 rounded object-cover border border-gray-700" 
                  alt="Profile" 
                />
              </button>
            </div>
          </nav>

      {activeTab === 'online' ? (
        <OnlineWatchView
          onPlayVideo={handlePlayOnlineVideo}
          accentColor={settings.accentColor}
        />
      ) : !hasLibrary ? (
        <div className="flex-grow flex flex-col items-center justify-center text-center px-4 relative z-10 pt-20">
          <h2 className="text-2xl font-bold mb-2">Set up your library</h2>
          <p className="text-gray-400 mb-6 max-w-md">Choose one or more folders for movies and TV shows. You can pick different folders for each section.</p>
          <button 
            onClick={openLibrarySettings}
            className="mt-2 flex items-center justify-center gap-2 bg-accent text-white px-8 py-4 rounded font-bold text-xl hover:bg-red-700 transition shadow-lg hover:scale-105 active:scale-95"
          >
            <FolderSearch className="w-6 h-6" />
            Select Library Folders
          </button>
        </div>
      ) : loading ? (
        <div className="flex-grow flex items-center justify-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-accent border-solid shadow-lg"></div>
        </div>
      ) : files.length === 0 ? (
        <div className="flex-grow flex flex-col items-center justify-center text-center px-4 relative z-10 pt-20">
          <div className="w-24 h-24 mb-6 rounded-full bg-gray-800 flex items-center justify-center">
            <Search className="w-10 h-10 text-gray-500" />
          </div>
          <h2 className="text-3xl font-bold mb-2">No videos found</h2>
          <p className="text-gray-400 mb-8 max-w-md">
            We couldn't find any supported video files (.mp4, .mkv, .avi, etc.) in your selected folders.
          </p>
          <button 
            onClick={openLibrarySettings}
            className="border border-white/20 hover:bg-white/10 text-white px-6 py-2 rounded font-semibold transition"
          >
            Manage library folders
          </button>
        </div>
      ) : (
        <>
          {/* Hero Banner with Ken Burns, hidden while search is open */}
          {featured && !showSearch && !showHistory && (
            <div className="relative w-full overflow-hidden" style={{ height: `${85 / settings.uiScale}vh` }}>
                  {/* Image and Video Wrapper */}
                  <div className="absolute inset-0 w-full h-full bg-gray-900">
                    {/* Static Image */}
                    <div 
                      className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ${isVideoPlaying ? 'opacity-0' : 'opacity-100'}`}
                    >
                      {featuredImageSrc ? (
                        <img 
                          src={featuredImageSrc} 
                          alt={featured.meta?.title || featured.name}
                          className="w-full h-full object-cover opacity-80 animate-ken-burns scale-110"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-tr from-gray-900 to-gray-800" />
                      )}
                    </div>
  
                    {/* Video Preview */}
                    <div 
                      className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ${isVideoPlaying ? 'opacity-100' : 'opacity-0'}`}
                    >
                      {delayOver && !playingVideo && featuredPlayTarget && (
                        <video
                          ref={heroVideoRef}
                          src={`file:///${featuredPlayTarget.path.replace(/\\/g, '/')}`}
                          autoPlay
                          muted={isHeroMuted}
                          onPlay={() => setIsVideoPlaying(true)}
                          onTimeUpdate={handleHeroTimeUpdate}
                          onEnded={() => setIsVideoPlaying(false)}
                          className="w-full h-full object-cover opacity-80"
                        />
                      )}
                    </div>
                  </div>
              
              <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
              
                <div className="absolute bottom-[25%] left-10 right-10 z-10 flex justify-between items-end">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={featured.path}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.5 }}
                      className="max-w-2xl"
                    >
                      <h1 className="text-5xl md:text-7xl font-bold mb-4 drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]">
                        {featured.meta?.title || featured.name}
                      </h1>
                      <p className="text-lg md:text-xl text-gray-200 mb-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] line-clamp-3 font-medium">
                        {(featuredLocalOnly ? featured.meta?.description : (featuredTmdb?.synopsis || featured.meta?.description)) || 'A local media file from your personal collection.'}
                      </p>
                      <div className="flex gap-4">
                        <button 
                          onClick={() => handlePlayVideo(featured)}
                          className="flex items-center gap-2 bg-white text-black px-8 py-3 rounded text-xl font-bold hover:bg-white/80 transition"
                        >
                          <Play className="w-7 h-7 fill-black" /> Play
                        </button>
                        <button 
                          onClick={() => handleOpenInfo(featured)}
                          className="flex items-center gap-2 bg-gray-500/70 text-white px-8 py-3 rounded text-xl font-bold hover:bg-gray-500/50 transition"
                        >
                          <Info className="w-7 h-7" /> More Info
                        </button>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                  
                  {/* Mute Toggle Button */}
                  <button 
                    onClick={() => setIsHeroMuted(!isHeroMuted)}
                    className="p-3 border rounded-full border-gray-400 bg-black/40 hover:bg-white/20 transition text-white mb-8"
                  >
                    {isHeroMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                  </button>
                </div>
            </div>
          )}

          {/* Carousel Rows, hidden while search is open */}
          <div className={`px-2 relative z-10 flex-grow pb-20 ${showSearch || showHistory ? 'hidden' : featured ? '-mt-32' : ''}`}>
            {(activeTab === 'movies' || activeTab === 'tv') && !showSearch && !showHistory && (
              <div className="flex justify-end px-8 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    setManageListsKind(activeTab === 'tv' ? 'tv' : 'movie');
                    setShowManageLists(true);
                  }}
                  className="text-sm font-semibold text-gray-400 hover:text-white transition pointer-events-auto"
                >
                  Manage lists
                </button>
              </div>
            )}
            {activeTab === 'home' && top10.length > 0 && (
              <ContentRow title="Top 10 in Your House Today" videos={top10} onPlay={handlePlayVideo} onInfo={handleOpenInfo} isTop10={true} activeProfileId={activeProfile} watchedIndicatorMode={settings.watchedIndicatorMode} />
            )}
            {activeTab === 'home' && continueWatchingAll.length > 0 && (
              <ContentRow title="Continue Watching" videos={continueWatchingAll} onPlay={handlePlayVideo} onInfo={handleOpenInfo} progresses={progresses} activeProfileId={activeProfile} watchedIndicatorMode={settings.watchedIndicatorMode} />
            )}
            {activeTab === 'tv' && continueWatchingTv.length > 0 && (
              <ContentRow title="Continue Watching" videos={continueWatchingTv} onPlay={handlePlayVideo} onInfo={handleOpenInfo} progresses={progresses} activeProfileId={activeProfile} watchedIndicatorMode={settings.watchedIndicatorMode} />
            )}
            {(activeTab === 'home' || activeTab === 'movies') && continueWatchingMovies.length > 0 && (
              <ContentRow title="Continue Watching" videos={continueWatchingMovies} onPlay={handlePlayVideo} onInfo={handleOpenInfo} progresses={progresses} activeProfileId={activeProfile} watchedIndicatorMode={settings.watchedIndicatorMode} />
            )}
            {activeTab === 'movies' && movieListRows.map(({ list, videos }) => (
              <ContentRow
                key={`user-list-${list.id}`}
                title={list.name}
                videos={videos}
                onPlay={handlePlayVideo}
                onInfo={handleOpenInfo}
                progresses={progresses}
                expandable
                mediaType="movie"
                activeProfileId={activeProfile}
                watchedIndicatorMode={settings.watchedIndicatorMode}
                userListId={list.id}
                bulkAddCatalog={movies}
              />
            ))}
            {activeTab === 'tv' && tvListRows.map(({ list, videos }) => (
              <ContentRow
                key={`user-list-${list.id}`}
                title={list.name}
                videos={videos}
                onPlay={handlePlayVideo}
                onInfo={handleOpenInfo}
                progresses={progresses}
                expandable
                mediaType="tv"
                activeProfileId={activeProfile}
                watchedIndicatorMode={settings.watchedIndicatorMode}
                userListId={list.id}
                bulkAddCatalog={folders}
              />
            ))}
            
            {activeTab === 'home' && heroCatalog.length > 0 && (
              <ContentRow title="Home" videos={heroCatalog} onPlay={handlePlayVideo} onInfo={handleOpenInfo} progresses={progresses} expandable activeProfileId={activeProfile} watchedIndicatorMode={settings.watchedIndicatorMode} />
            )}
            
            {(activeTab === 'home' || activeTab === 'tv') && folders.length > 0 && (
              <ContentRow title="Series" videos={folders} onPlay={handlePlayVideo} onInfo={handleOpenInfo} progresses={progresses} expandable activeProfileId={activeProfile} watchedIndicatorMode={settings.watchedIndicatorMode} />
            )}

            {activeTab === 'home' && animeCatalog.length > 0 && (
              <ContentRow title="Anime" videos={animeCatalog} onPlay={handlePlayVideo} onInfo={handleOpenInfo} progresses={progresses} expandable activeProfileId={activeProfile} watchedIndicatorMode={settings.watchedIndicatorMode} />
            )}
            
            {(activeTab === 'home' || activeTab === 'movies') && movies.length > 0 && (
              <ContentRow title="Movies" videos={movies} onPlay={handlePlayVideo} onInfo={handleOpenInfo} progresses={progresses} expandable activeProfileId={activeProfile} watchedIndicatorMode={settings.watchedIndicatorMode} />
            )}

            {activeTab === 'movies' && movieGenreRows.map((row) => (
              <ContentRow
                key={`movie-genre-${row.title}`}
                title={row.title}
                videos={row.videos}
                onPlay={handlePlayVideo}
                onInfo={handleOpenInfo}
                progresses={progresses}
                expandable
                mediaType="movie"
                activeProfileId={activeProfile}
                watchedIndicatorMode={settings.watchedIndicatorMode}
              />
            ))}

            {activeTab === 'tv' && tvGenreRows.map((row) => (
              <ContentRow
                key={`tv-genre-${row.title}`}
                title={row.title}
                videos={row.videos}
                onPlay={handlePlayVideo}
                onInfo={handleOpenInfo}
                progresses={progresses}
                expandable
                mediaType="tv"
                activeProfileId={activeProfile}
                watchedIndicatorMode={settings.watchedIndicatorMode}
              />
            ))}
          </div>
        </>
      )}

      {showManageLists && activeProfile && (
        <ManageListsModal
          profileId={activeProfile}
          defaultKind={manageListsKind}
          onClose={() => setShowManageLists(false)}
        />
      )}

      {/* Detail Modal */}
      {infoVideo && (
        <DetailModal
          key={infoVideo.path}
          video={infoVideo}
          watchedRevision={watchedTick}
          initialSubfolder={infoInitialSubfolder}
          onClose={closeInfo}
          onPlay={(v) => { closeInfo(); handlePlayVideo(v); }}
          onUpdate={handleUpdateVideo}
          onReset={handleResetVideo}
          onEpisodeEnriched={handleEpisodeEnriched}
          progresses={progresses}
          activeProfileId={activeProfile}
          onWatchedChange={handleWatchedChange}
          watchedIndicatorMode={settings.watchedIndicatorMode}
          detailModalActionsMode={settings.detailModalActionsMode}
        />
      )}

      {/* Backdrop while the player windows sit on top; the top strip stays draggable */}
      {playingVideo && (
        <div className="fixed inset-0 z-[1000] bg-black">
          <div
            className="h-8 flex items-center justify-between px-4 text-xs text-white/50 truncate pr-40"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <span className="truncate">{settings.appName} · {playingVideo.meta?.title || playingVideo.name}</span>
            <button
              onClick={() => {
                window.electronAPI?.playerExit?.({
                  path: playingVideo.path,
                  position: 0,
                  duration: 0,
                });
              }}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className="ml-4 shrink-0 text-white/70 hover:text-white px-2 py-0.5 rounded hover:bg-white/10 text-xs transition cursor-pointer"
            >
              ← Back
            </button>
          </div>
        </div>
      )}
        </>
      )}

      {/* Search Overlay */}
      {showSearch && activeProfile && (
        <SearchOverlay
          files={searchCatalog}
          onClose={() => setShowSearch(false)}
          onPlay={handlePlayVideo}
          onInfo={handleOpenInfo}
          progresses={progresses}
          activeProfileId={activeProfile}
          watchedIndicatorMode={settings.watchedIndicatorMode}
          initialMediaType={
            activeTab === 'movies' ? 'movie' : activeTab === 'tv' ? 'tv' : 'all'
          }
        />
      )}

      {showHistory && activeProfile && (
        <WatchHistoryOverlay
          profileId={activeProfile}
          files={files}
          progresses={progresses}
          onClose={() => setShowHistory(false)}
          onPlay={handlePlayVideo}
          onInfo={handleOpenInfo}
        />
      )}

      <AnimatePresence>
        {showUpdateNotice && appUpdateInfo?.status === 'update' && (
          <UpdateAvailableNotice
            latestVersion={appUpdateInfo.latestVersion}
            releaseUrl={appUpdateInfo.releaseUrl}
            onDismiss={handleDismissUpdateNotice}
          />
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal 
          currentSettings={settings}
          initialTab={settingsTab}
          appUpdateInfo={appUpdateInfo}
          onScanLibrary={() => scanLibrary(true)}
          librarySyncing={librarySyncing}
          onSave={(newSettings) => {
            setSettings(newSettings);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Global Styles */}
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        @keyframes kenBurns {
          0% { transform: scale(1.1); }
          50% { transform: scale(1.15) translate(-1%, -1%); }
          100% { transform: scale(1.1); }
        }
        .animate-ken-burns {
          animation: kenBurns 20s ease-in-out infinite alternate;
        }
      `}</style>
    </div>
  );
}
