import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Shuffle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { VideoCard, getVideoWatched, type LocalFile } from './NetflixUI';
import { cardProgress } from '../utils/grouping';
import type { Settings } from './SettingsModal';
import { SearchFilterSidebar } from './SearchFilterSidebar';
import {
  applyCatalogFilters,
  collectGenres,
  getItemSearchGenres,
  DEFAULT_CATALOG_FILTERS,
  type CatalogFilters,
  type MediaTypeFilter,
} from '../utils/catalogFilters';

function getSearchText(file: LocalFile): string {
  const episodeText = file.folderFiles
    ? file.folderFiles.flatMap((ep) => [ep.name, ep.meta?.title, ep.relativePath]).filter(Boolean).join(' ')
    : '';
  const genreText = getItemSearchGenres(file).join(' ');
  return [
    file.meta?.title,
    file.name,
    file.meta?.genre,
    genreText,
    file.meta?.description,
    file.meta?.year,
    file.folderName,
    file.relativePath,
    episodeText,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function SearchOverlay({
  files,
  onClose,
  onPlay,
  onInfo,
  progresses = {},
  activeProfileId,
  watchedIndicatorMode = 'always',
  initialMediaType = 'all',
}: {
  files: LocalFile[];
  onClose: () => void;
  onInfo: (v: LocalFile) => void;
  onPlay: (v: LocalFile) => void;
  progresses?: Record<string, number>;
  activeProfileId?: string | null;
  watchedIndicatorMode?: Settings['watchedIndicatorMode'];
  /** Match Movies / TV tab when opening search so the grid and Play random stay in sync. */
  initialMediaType?: MediaTypeFilter;
}) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CatalogFilters>(() => ({
    ...DEFAULT_CATALOG_FILTERS,
    mediaType: initialMediaType,
  }));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const availableGenres = useMemo(() => collectGenres(files), [files]);

  /** Same list rendered in the grid (search text + sidebar filters). */
  const displayedVideos = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q ? files.filter((f) => getSearchText(f).includes(q)) : files;
    list = applyCatalogFilters(list, filters, progresses, activeProfileId);
    return list;
  }, [files, query, filters, progresses, activeProfileId]);

  const playRandom = () => {
    if (displayedVideos.length === 0) return;
    const pick = displayedVideos[Math.floor(Math.random() * displayedVideos.length)];
    onClose();
    onPlay(pick);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="fixed top-20 left-0 right-0 bottom-0 z-40 bg-[#141414] flex flex-col"
      >
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          className="flex flex-col flex-1 min-h-0"
        >
          {/* Search bar below header */}
          <div className="flex items-center justify-end px-6 md:px-10 py-4 shrink-0 border-b border-gray-800/50">
            <div className="flex items-center gap-2 bg-[#181818] border border-gray-700 rounded-full px-4 py-2 w-full max-w-md">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles, genres..."
                className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-gray-500 min-w-0"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="p-0.5 text-gray-400 hover:text-white transition flex-shrink-0"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {displayedVideos.length > 0 && (
              <button
                type="button"
                onClick={playRandom}
                className="ml-3 flex items-center gap-2 bg-white text-black px-3 py-2 rounded font-bold text-sm hover:bg-white/80 transition shrink-0"
              >
                <Shuffle className="w-4 h-4" /> Play random
              </button>
            )}
            <button
              onClick={onClose}
              className="ml-3 p-2 text-gray-400 hover:text-white transition flex-shrink-0"
              aria-label="Close search"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Main: sidebar + grid */}
          <div className="flex flex-1 min-h-0">
            <SearchFilterSidebar filters={filters} onChange={setFilters} genres={availableGenres} />

            <div className="flex-1 overflow-y-auto px-6 md:px-10 pl-10 md:pl-14 pb-10 pt-4 min-h-0 overscroll-contain">
              {displayedVideos.length === 0 ? (
                <p className="text-gray-500 text-lg mt-8">
                  {query ? `No results for "${query}"` : 'No titles match your filters'}
                </p>
              ) : (
                <>
                <p className="text-sm text-gray-400 font-medium pt-12 pb-1 tracking-wide">
                  {query.trim() ? (
                    <>
                      <span className="text-gray-300">{displayedVideos.length}</span>
                      {' '}result{displayedVideos.length !== 1 ? 's' : ''} for &ldquo;{query.trim()}&rdquo;
                    </>
                  ) : (
                    <>
                      Showing <span className="text-gray-300">{displayedVideos.length}</span>
                      {' '}title{displayedVideos.length !== 1 ? 's' : ''}
                    </>
                  )}
                </p>
                <div className="pt-32 pl-4 pr-6 pb-12 overflow-visible">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-20 overflow-visible">
                  {displayedVideos.map((video, i) => (
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
                </>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
