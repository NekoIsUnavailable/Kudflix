export {};

declare global {
  interface MpvTrack {
    id: number;
    type: 'video' | 'audio' | 'sub' | string;
    title?: string;
    lang?: string;
    codec?: string;
    selected?: boolean;
    external?: boolean;
    'external-filename'?: string;
    'demux-channel-count'?: number;
    'audio-channels'?: number;
    default?: boolean;
  }

  interface PlayerState {
    timePos: number;
    duration: number;
    pause: boolean;
    volume: number;
    mute: boolean;
    speed: number;
    buffering: boolean;
    seeking: boolean;
    eof: boolean;
    loaded: boolean;
    error: string | null;
    tracks: MpvTrack[];
    audioId: number | null;
  }

  interface PlayerSession {
    path: string;
    title: string;
    subtitle?: string;
    thumbnail?: string | null;
    profileId: string;
    startTime: number;
    prev?: { path: string; title: string; subtitle?: string; thumbnail?: string } | null;
    next: { path: string; title: string; subtitle?: string; thumbnail?: string } | null;
    /** Per-show next-episode window before end (seconds); 0 = default 20s. */
    outroSkipSeconds?: number;
    /** Names the player window so it is recognisable in screen-share pickers. */
    appName?: string;
  }

  interface PlayerExitPayload {
    path: string;
    position: number;
    duration: number;
  }

  interface ProbeTrack {
    index: number;
    mpvId: number;
    codec: string;
    language: string;
    title: string;
    label: string;
  }

  interface ExternalSubtitleFile {
    path: string;
    name: string;
    language: string;
    label: string;
  }

  interface OnlineVideo {
    id: string;
    url: string;
    title: string;
    channel: string;
    duration: number;
    thumbnail: string | null;
    viewCount: number | null;
    description: string;
  }

  interface SubtitleStyleOptions {
    scale?: number;
    fontSize?: number;
    color?: string;
    marginY?: number;
    borderSize?: number;
    backColor?: string;
    shadowOffset?: number;
  }

  interface PlayerOpenOptions {
    volume?: number;
    mute?: boolean;
    startTime?: number;
    audioId?: number;
    subtitleId?: number | 'no';
    externalSubtitle?: string;
    subtitleStyle?: SubtitleStyleOptions;
  }

  interface Window {
    electronAPI: {
      scanDirectory: (dirPath: string) => Promise<{name: string, path: string, relativePath?: string, folderName?: string, localPoster?: string | null, localFanart?: string | null, localNfoContent?: string | null, mtimeMs?: number}[]>;
      setAppIcon: (variant: 'default' | 'alternate') => Promise<{ ok: boolean; shortcutsUpdated: boolean }>;
      getAppIconPath: (variant: 'default' | 'alternate') => Promise<string | null>;
      updateLibraryWatch: (folders: string[]) => Promise<{ ok: boolean }>;
      onLibraryChanged: (callback: () => void) => () => void;
      onLibraryPathsRemoved: (callback: (paths: string[]) => void) => () => void;
      pathExists: (filePath: string) => Promise<boolean>;
      showInExplorer: (filePath: string) => Promise<{ ok: boolean }>;
      selectFolder: () => Promise<string | null>;
      selectFolders: () => Promise<string[]>;
      selectFile: () => Promise<string | null>;
      cacheProfileImage: () => Promise<string | null>;
      pickProfileImage: () => Promise<string | null>;
      saveProfileImage: (dataUrl: string) => Promise<string | null>;
      getAppVersion: () => Promise<string>;
      selectWallpaperImage: () => Promise<string | null>;
      playInExternalPlayer: (playerPath: string, videoPath: string) => Promise<void>;
      probeMedia: (videoPath: string) => Promise<{ audioCodec: string | null; hasAudio: boolean | null }>;
      probeMediaDuration: (videoPath: string) => Promise<number | null>;
      probeTracks: (videoPath: string) => Promise<{ audio: ProbeTrack[]; subtitles: ProbeTrack[] }>;
      findSubtitleFiles: (videoPath: string) => Promise<ExternalSubtitleFile[]>;
      selectSubtitleFile: () => Promise<string | null>;
      setDiscordRpcEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
      setDiscordRpcClientId: (clientId: string) => Promise<{ ok: boolean }>;
      setDiscordRpcActivityStyle?: (style: 'media' | 'watching' | 'playing') => Promise<{ ok: boolean }>;
      searchOnline?: (query: string) => Promise<{ ok: boolean; results?: OnlineVideo[]; error?: string }>;

      playerStart: (session: PlayerSession) => Promise<{ ok: boolean }>;
      onPlayerExited: (callback: (payload: PlayerExitPayload | null) => void) => () => void;
      onPlayerRequestNext: (callback: (targetPath: string | null) => void) => () => void;
      onPlayerRequestPrev: (callback: (targetPath: string | null) => void) => () => void;

      playerGetSession: () => Promise<PlayerSession | null>;
      onPlayerSession: (callback: (session: PlayerSession) => void) => () => void;
      playerOpen: (filePath: string, options?: PlayerOpenOptions) => Promise<{ ok: boolean; error?: string; state?: PlayerState }>;
      playerCommand: (action: string, value?: unknown) => Promise<{ ok: boolean; error?: string }>;
      playerToggleFullscreen: () => Promise<boolean>;
      playerSetFullscreen: (fullscreen: boolean) => Promise<boolean>;
      playerRequestNext: (targetPath?: string) => Promise<{ ok: boolean }>;
      playerRequestPrev: (targetPath?: string) => Promise<{ ok: boolean }>;
      playerExit: (payload: PlayerExitPayload | null) => Promise<{ ok: boolean }>;
      onPlayerState: (callback: (state: PlayerState) => void) => () => void;
      onPlayerFullscreen: (callback: (fullscreen: boolean) => void) => () => void;
    }
  }
}
