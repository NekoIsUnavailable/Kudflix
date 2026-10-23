import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Pencil, Plus, Search, Shuffle, Trash2, X } from 'lucide-react';
import {
  VideoCard,
  getVideoWatched,
  type LocalFile,
} from './NetflixUI';
import { SearchFilterSidebar } from './SearchFilterSidebar';
import { cardProgress } from '../utils/grouping';
import type { Settings } from './SettingsModal';
import {
  applyCatalogFilters,
  collectGenres,
  DEFAULT_CATALOG_FILTERS,
  getItemSearchGenres,
  type CatalogFilters,
} from '../utils/catalogFilters';
import { useUserLists } from '../hooks/useUserLists';
import {
  addItemsToList,
  deleteList,
  renameList,
  resolveListVideos,
  validateListName,
  type ListKind,
} from '../utils/userLists';
import { ThemedSelect, GRID_SORT_OPTIONS } from './ThemedSelect';
import { ConfirmDialog } from './ConfirmDialog';

type GridSort = 'az' | 'za' | 'year-new' | 'year-old' | 'recent' | 'duration-short' | 'duration-long';
type Panel = 'titles' | 'add';

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
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getSortTitle(v: LocalFile): string {
  return (v.meta?.title || v.name).toLowerCase();
}

function getSortYear(v: LocalFile): number {
  const y = v.meta?.year;
  if (!y) return 0;
  const n = parseInt(y, 10);
  return Number.isFinite(n) ? n : 0;
}

function getSortDuration(v: LocalFile): number {
  if (v.isFolder && v.folderFiles?.length) {
    return v.folderFiles.reduce((sum, ep) => sum + (ep.duration ?? 0), 0);
  }
  return v.duration ?? 0;
}

export function UserListGridModal({
  profileId,
  listId,
  catalog,
  onClose,
  onPlay,
  onInfo,
  onListDeleted,
  progresses = {},
  watchedIndicatorMode = 'always',
}: {
  profileId: string;
  listId: string;
  catalog: LocalFile[];
  onClose: () => void;
  onPlay: (v: LocalFile) => void;
  onInfo: (v: LocalFile) => void;
  onListDeleted?: () => void;
  progresses?: Record<string, number>;
  watchedIndicatorMode?: Settings['watchedIndicatorMode'];
}) {
  const lists = useUserLists(profileId);
  const list = lists.find((l) => l.id === listId);
  const listVideos = useMemo(
    () => (list ? resolveListVideos(list, catalog) : []),
    [list, catalog],
  );

  const [panel, setPanel] = useState<Panel>('titles');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sort, setSort] = useState<GridSort>('az');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [addQuery, setAddQuery] = useState('');
  const [addFilters, setAddFilters] = useState<CatalogFilters>(() => ({
    ...DEFAULT_CATALOG_FILTERS,
    mediaType: list?.kind === 'tv' ? 'tv' : 'movie',
  }));

  const kind: ListKind = list?.kind ?? 'movie';
  const mediaType = kind === 'tv' ? 'tv' : 'movie';

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  useEffect(() => {
    setAddFilters((f) => ({ ...f, mediaType: kind === 'tv' ? 'tv' : 'movie' }));
  }, [kind]);

  const sortedListVideos = useMemo(() => {
    const listCopy = [...listVideos];
    switch (sort) {
      case 'az':
        return listCopy.sort((a, b) => getSortTitle(a).localeCompare(getSortTitle(b)));
      case 'za':
        return listCopy.sort((a, b) => getSortTitle(b).localeCompare(getSortTitle(a)));
      case 'year-new':
        return listCopy.sort((a, b) => getSortYear(b) - getSortYear(a));
      case 'year-old':
        return listCopy.sort((a, b) => getSortYear(a) - getSortYear(b));
      case 'recent':
        return listCopy.sort((a, b) => (b.dateModified ?? 0) - (a.dateModified ?? 0));
      case 'duration-short':
        return listCopy.sort((a, b) => getSortDuration(a) - getSortDuration(b));
      case 'duration-long':
        return listCopy.sort((a, b) => getSortDuration(b) - getSortDuration(a));
      default:
        return listCopy;
    }
  }, [listVideos, sort]);

  const inListPaths = useMemo(() => new Set(list?.paths ?? []), [list?.paths]);

  const addCandidates = useMemo(() => {
    const pool = catalog.filter((item) => !inListPaths.has(item.path));
    const q = addQuery.trim().toLowerCase();
    let filtered = applyCatalogFilters(pool, addFilters, progresses, profileId);
    if (q) filtered = filtered.filter((f) => getSearchText(f).includes(q));
    return filtered;
  }, [catalog, inListPaths, addFilters, addQuery, progresses, profileId]);

  const addGenres = useMemo(() => collectGenres(catalog), [catalog]);

  const startRename = () => {
    if (!list) return;
    setNameDraft(list.name);
    setNameError(null);
    setEditingName(true);
  };

  const saveRename = () => {
    const err = validateListName(nameDraft);
    if (err) {
      setNameError(err);
      return;
    }
    if (!renameList(profileId, listId, nameDraft)) {
      setNameError('Could not rename list.');
      return;
    }
    setEditingName(false);
    setNameError(null);
  };

  const confirmDelete = () => {
    deleteList(profileId, listId);
    setShowDeleteConfirm(false);
    onListDeleted?.();
    onClose();
  };

  const handleBulkAdd = () => {
    const paths = addCandidates.map((v) => v.path);
    addItemsToList(profileId, listId, paths);
    setPanel('titles');
  };

  const playRandomFromList = () => {
    if (sortedListVideos.length === 0) return;
    const pick = sortedListVideos[Math.floor(Math.random() * sortedListVideos.length)];
    onClose();
    onPlay(pick);
  };

  if (!list) {
    return createPortal(
      <div className="fixed inset-0 z-[500] bg-[#141414] flex items-center justify-center">
        <p className="text-gray-400">This list no longer exists.</p>
        <button type="button" onClick={onClose} className="ml-4 text-white underline">
          Close
        </button>
      </div>,
      document.body,
    );
  }

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
          <div className="flex items-start justify-between gap-4 px-10 pb-4 shrink-0 flex-wrap">
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') setEditingName(false);
                    }}
                    maxLength={40}
                    autoFocus
                    className="text-2xl md:text-3xl font-bold bg-[#242424] border border-gray-600 rounded-lg px-3 py-1 text-white outline-none focus:border-white max-w-md"
                  />
                  <button
                    type="button"
                    onClick={saveRename}
                    className="px-3 py-1.5 rounded bg-white text-black text-sm font-bold hover:bg-white/90"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingName(false)}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  {nameError && <p className="w-full text-sm text-red-400">{nameError}</p>}
                </div>
              ) : (
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-3xl md:text-4xl font-bold text-white truncate">{list.name}</h2>
                  <button
                    type="button"
                    onClick={startRename}
                    className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition"
                    aria-label="Rename list"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanel((p) => (p === 'add' ? 'titles' : 'add'))}
                    className={`p-2 rounded-full transition ${
                      panel === 'add'
                        ? 'text-white bg-white/15'
                        : 'text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                    aria-label={panel === 'add' ? 'Back to list' : 'Add titles'}
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-2 rounded-full text-gray-400 hover:text-red-400 hover:bg-white/10 transition"
                    aria-label="Delete list"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              )}
              <p className="text-sm text-gray-500 mt-1">
                {listVideos.length} {listVideos.length === 1 ? 'title' : 'titles'} ·{' '}
                {kind === 'movie' ? 'Movies' : 'TV Shows'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 bg-[#181818]/80 rounded-full hover:bg-white hover:text-black transition text-white border border-white/20 shrink-0"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <AnimatePresence mode="wait" initial={false}>
          {panel === 'titles' ? (
            <motion.div
              key="list-titles"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex flex-col flex-1 min-h-0"
            >
              <div className="flex items-center gap-4 px-10 py-4 shrink-0 flex-wrap">
                <ThemedSelect
                  value={sort}
                  onChange={setSort}
                  options={GRID_SORT_OPTIONS}
                  className="w-auto"
                  buttonClassName="w-auto min-w-[10rem]"
                  menuZIndex={550}
                />
                {sortedListVideos.length > 0 && (
                  <button
                    type="button"
                    onClick={playRandomFromList}
                    className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded font-bold text-sm hover:bg-white/80 transition"
                  >
                    <Shuffle className="w-4 h-4" /> Play random
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-10 pl-14 pb-10 min-h-0 overscroll-contain">
                {sortedListVideos.length === 0 ? (
                  <p className="text-gray-500 mt-8">
                    No titles yet. Use the <span className="text-gray-300">+</span> button above to add some.
                  </p>
                ) : (
                  <div className="pt-32 pl-4 pr-6 pb-12 overflow-visible">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-20 overflow-visible">
                    {sortedListVideos.map((video, i) => (
                      <div key={`${video.path}-${i}`} className="relative hover:z-[600] overflow-visible">
                        <VideoCard
                          video={video}
                          onPlay={(v) => {
                            onClose();
                            onPlay(v);
                          }}
                          onInfo={(v) => {
                            onClose();
                            onInfo(v);
                          }}
                          variant="grid"
                          enableHoverExpansion
                          progress={cardProgress(video, progresses)}
                          watched={getVideoWatched(video, progresses, profileId)}
                          watchedIndicatorMode={watchedIndicatorMode}
                          activeProfileId={profileId}
                        />
                      </div>
                    ))}
                  </div>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="list-add"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex flex-1 min-h-0"
            >
            <div className="flex flex-1 min-h-0 w-full">
              <SearchFilterSidebar
                filters={addFilters}
                onChange={setAddFilters}
                genres={addGenres}
                lockMediaType={mediaType}
              />
              <div className="flex flex-col flex-1 min-h-0 min-w-0">
                <div className="flex items-center gap-3 px-6 md:px-8 py-4 shrink-0 border-b border-gray-800/50 flex-wrap">
                  <div className="flex items-center gap-2 bg-[#181818] border border-gray-700 rounded-full px-4 py-2 flex-1 min-w-[200px] max-w-lg">
                    <Search className="w-4 h-4 text-gray-400 shrink-0" />
                    <input
                      type="text"
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                      placeholder="Search titles, genres..."
                      className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-gray-500 min-w-0"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={addCandidates.length === 0}
                    onClick={handleBulkAdd}
                    className="px-5 py-2.5 rounded font-bold text-sm bg-accent text-white hover:bg-red-700 transition disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Add {addCandidates.length} title{addCandidates.length !== 1 ? 's' : ''}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 md:px-8 pl-10 md:pl-12 pb-10 pt-4 min-h-0 overscroll-contain">
                  {addCandidates.length === 0 ? (
                    <p className="text-gray-500 mt-8">No matching titles to add (or already in this list).</p>
                  ) : (
                    <>
                      <p className="text-sm text-gray-400 mb-4 px-8 pt-4">
                        {addCandidates.length} match{addCandidates.length !== 1 ? 'es' : ''} — use filters or search, then add in bulk.
                      </p>
                      <div className="pt-32 pl-4 pr-6 pb-12 overflow-visible">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-20 overflow-visible">
                        {addCandidates.map((video, i) => (
                          <div key={`${video.path}-${i}`} className="relative hover:z-[600] overflow-visible">
                            <VideoCard
                              video={video}
                              onPlay={(v) => {
                                onClose();
                                onPlay(v);
                              }}
                              onInfo={(v) => {
                                onClose();
                                onInfo(v);
                              }}
                              variant="grid"
                              enableHoverExpansion
                              progress={cardProgress(video, progresses)}
                              watched={getVideoWatched(video, progresses, profileId)}
                              watchedIndicatorMode={watchedIndicatorMode}
                              activeProfileId={profileId}
                            />
                          </div>
                        ))}
                      </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            </motion.div>
          )}
          </AnimatePresence>

          <ConfirmDialog
            open={showDeleteConfirm}
            onClose={() => setShowDeleteConfirm(false)}
            onConfirm={confirmDelete}
            title="Delete this list?"
            confirmLabel="Delete list"
            danger
            zIndex={600}
          >
            <p>
              <span className="text-gray-200 font-semibold">{list.name}</span> will be permanently removed. Titles in
              your library are not deleted.
            </p>
          </ConfirmDialog>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
