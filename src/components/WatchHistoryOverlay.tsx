import { useEffect, useMemo, useState } from 'react';
import { History, Play, Info, X, Trash2, Plus, Pencil, Check, FolderX } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LocalFile } from './NetflixUI';
import { useWatchHistory } from '../hooks/useWatchHistory';
import { clearWatchHistory, removeWatchHistoryEntry, updateWatchHistoryWatchedAt, type WatchHistoryEntry } from '../utils/watchHistory';
import { WatchHistoryImportPanel } from './WatchHistoryImportPanel';
import { getWatchHistoryThumb } from '../utils/thumbnailCache';
import { formatDurationShort } from '../utils/subtitles';
import { ConfirmDialog } from './ConfirmDialog';
import { ThemedDatetimeEditor } from './ThemedDatetimeEditor';

function normPath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

function findFileByPath(files: LocalFile[], path: string): LocalFile | null {
  const key = normPath(path);
  for (const f of files) {
    if (normPath(f.path) === key) return f;
    if (f.folderFiles) {
      for (const ep of f.folderFiles) {
        if (normPath(ep.path) === key) return ep;
      }
    }
  }
  return null;
}

function formatWatchedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function formatHistoryGenre(genre: string | undefined, mediaType: WatchHistoryEntry['mediaType']): string | undefined {
  if (!genre) return undefined;
  if (genre === 'Local Media' && mediaType === 'movie') return 'Movie';
  return genre;
}

function formatWatchProgress(position: number, duration: number): string {
  const watchedFor = duration > 0 ? formatDurationShort(position) : '—';
  const total = duration > 0 ? formatDurationShort(duration) : null;
  const pct =
    duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : null;
  let line = `Watched ${watchedFor}`;
  if (total) line += ` of ${total}`;
  if (pct != null) line += ` (${pct}%)`;
  return line;
}

function HistoryThumb({ entry, liveFile }: { entry: WatchHistoryEntry; liveFile: LocalFile | null }) {
  const [src, setSrc] = useState<string | null>(
    liveFile?.thumbnail || liveFile?.meta?.poster || null,
  );

  useEffect(() => {
    let cancelled = false;
    if (entry.thumbnailKey) {
      void getWatchHistoryThumb(entry.thumbnailKey).then((thumb) => {
        if (!cancelled && thumb) setSrc(thumb);
      });
    } else if (liveFile?.thumbnail || liveFile?.meta?.poster) {
      setSrc(liveFile.thumbnail || liveFile.meta?.poster || null);
    }
    return () => {
      cancelled = true;
    };
  }, [entry.thumbnailKey, entry.id, liveFile?.path, liveFile?.thumbnail, liveFile?.meta?.poster]);

  if (!src) {
    return (
      <div className="w-36 md:w-44 aspect-video rounded-md bg-gray-800 flex items-center justify-center text-gray-500 text-xs shrink-0">
        No image
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="w-36 md:w-44 aspect-video rounded-md object-cover bg-gray-800 shrink-0"
    />
  );
}

function HistoryRow({
  entry,
  liveFile,
  profileId,
  onPlay,
  onInfo,
}: {
  entry: WatchHistoryEntry;
  liveFile: LocalFile | null;
  profileId: string;
  onPlay: (v: LocalFile) => void;
  onInfo: (v: LocalFile) => void;
}) {
  const inLibrary = Boolean(liveFile);
  const [editingDate, setEditingDate] = useState(false);
  const [dateDraftIso, setDateDraftIso] = useState(entry.watchedAt);

  useEffect(() => {
    if (!editingDate) setDateDraftIso(entry.watchedAt);
  }, [entry.watchedAt, editingDate]);

  const saveDate = () => {
    if (updateWatchHistoryWatchedAt(profileId, entry.id, dateDraftIso)) {
      setEditingDate(false);
    }
  };

  const genreLabel = formatHistoryGenre(entry.genre, entry.mediaType);

  return (
    <div className="group/row flex gap-4 md:gap-6 py-4 border-b border-gray-800/80 last:border-0">
      <HistoryThumb entry={entry} liveFile={liveFile} />
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-white font-bold text-base md:text-lg truncate">{entry.title}</h3>
          {entry.completed ? (
            <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded bg-green-500/20 text-green-400">
              Completed
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
              Partial
            </span>
          )}
          {!inLibrary && (
            <span
              className="group/missing inline-flex items-center max-w-[1.5rem] hover:max-w-[12rem] overflow-hidden rounded bg-gray-600/40 text-gray-400 shrink-0 transition-[max-width] duration-200 ease-out"
              title="Not found in library"
              aria-label="Not found in library"
            >
              <span className="inline-flex items-center justify-center w-6 h-6 shrink-0">
                <FolderX className="w-3.5 h-3.5" strokeWidth={2.5} />
              </span>
              <span className="pr-2 text-[10px] font-semibold text-gray-300 whitespace-nowrap opacity-0 group-hover/missing:opacity-100 transition-opacity duration-150 delay-75">
                Not found in library
              </span>
            </span>
          )}
        </div>
        {entry.subtitle && <p className="text-sm text-gray-400 truncate">{entry.subtitle}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-0.5">
          {editingDate ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 bg-[#181818] px-2.5 py-2">
              <ThemedDatetimeEditor valueIso={dateDraftIso} onChange={setDateDraftIso} />
              <button
                type="button"
                onClick={saveDate}
                className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white transition"
                aria-label="Save date"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDateDraftIso(entry.watchedAt);
                  setEditingDate(false);
                }}
                className="text-xs font-semibold text-gray-500 hover:text-white px-1"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500">{formatWatchedAt(entry.watchedAt)}</p>
              <button
                type="button"
                onClick={() => setEditingDate(true)}
                className="p-1 rounded text-gray-500 hover:text-white hover:bg-white/10 transition"
                aria-label="Edit watch date"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-gray-500">
          {formatWatchProgress(entry.position, entry.duration)}
          {entry.year ? ` · ${entry.year}` : ''}
          {genreLabel ? ` · ${genreLabel}` : ''}
        </p>
        {inLibrary && liveFile && (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                onPlay(liveFile);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white text-black text-xs font-bold hover:bg-white/90 transition"
            >
              <Play className="w-3.5 h-3.5 fill-black" /> Play
            </button>
            <button
              type="button"
              onClick={() => onInfo(liveFile)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition"
            >
              <Info className="w-3.5 h-3.5" /> Info
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void removeWatchHistoryEntry(profileId, entry.id);
        }}
        className="self-center shrink-0 p-2 rounded-lg text-gray-500 opacity-0 group-hover/row:opacity-100 hover:text-red-400 hover:bg-white/10 transition"
        aria-label="Remove from history"
        title="Remove from history"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export function WatchHistoryOverlay({
  profileId,
  files,
  progresses,
  onClose,
  onPlay,
  onInfo,
}: {
  profileId: string;
  files: LocalFile[];
  progresses: Record<string, number>;
  onClose: () => void;
  onPlay: (v: LocalFile) => void;
  onInfo: (v: LocalFile) => void;
}) {
  const history = useWatchHistory(profileId);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [importMode, setImportMode] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (importMode) setImportMode(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, importMode]);

  const fileIndex = useMemo(() => files, [files]);

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
          className="flex flex-col flex-1 min-h-0"
        >
          {!importMode ? (
            <>
              <div className="flex items-center justify-between gap-4 px-6 md:px-10 py-4 shrink-0 border-b border-gray-800/50">
                <div className="flex items-center gap-3">
                  <History className="w-5 h-5 text-gray-400" />
                  <h2 className="text-lg font-bold text-white">Watch history</h2>
                  <span className="text-sm text-gray-500">{history.length} entries</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setImportMode(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-semibold text-white bg-white/10 hover:bg-white/15 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Add from library
                  </button>
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-semibold text-gray-400 hover:text-red-400 hover:bg-white/5 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 text-gray-400 hover:text-white transition rounded-full hover:bg-white/10"
                    aria-label="Close history"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 md:px-10 pb-10 min-h-0">
                {history.length === 0 ? (
                  <div className="mt-10 text-center space-y-4">
                    <p className="text-gray-500">Nothing watched yet. Play something or add watched titles from your library.</p>
                    <button
                      type="button"
                      onClick={() => setImportMode(true)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-sm bg-white text-black hover:bg-white/90 transition"
                    >
                      <Plus className="w-4 h-4" /> Add from library
                    </button>
                  </div>
                ) : (
                  <div className="max-w-4xl mx-auto pt-4">
                    {history.map((entry) => (
                      <HistoryRow
                        key={entry.id}
                        entry={entry}
                        profileId={profileId}
                        liveFile={findFileByPath(fileIndex, entry.path)}
                        onPlay={(v) => {
                          onClose();
                          onPlay(v);
                        }}
                        onInfo={(v) => {
                          onClose();
                          onInfo(v);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <WatchHistoryImportPanel
              profileId={profileId}
              files={files}
              progresses={progresses}
              onBack={() => setImportMode(false)}
            />
          )}
        </motion.div>
      </motion.div>

      <ConfirmDialog
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          void clearWatchHistory(profileId).then(() => setShowClearConfirm(false));
        }}
        title="Clear watch history?"
        confirmLabel="Clear history"
        danger
        zIndex={500}
      >
        All watch history for this profile will be removed. This cannot be undone.
      </ConfirmDialog>
    </AnimatePresence>
  );
}
