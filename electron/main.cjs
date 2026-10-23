const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { MpvController } = require('./mpvController.cjs');
const { probeMediaAudio, probeMediaDuration, probeTracks, findSubtitleFiles } = require('./mediaUtils.cjs');
const { PlayerWindows, TITLE_STRIP_HEIGHT } = require('./playerWindows.cjs');
const { LibraryWatcher } = require('./libraryWatcher.cjs');
const appIcon = require('./appIcon.cjs');
const { discordRpc } = require('./discordRpc.cjs');
const { searchOnline } = require('./onlineSearch.cjs');

const isDev = !app.isPackaged;

let mainWindow = null;
let playerWindows = null;
let playerSession = null;
const mpvController = new MpvController();

let currentIconVariant = 'default';

function applyAppIcon(variant) {
  currentIconVariant = variant;
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  const image = appIcon.loadWindowIcon(variant);
  if (!image) {
    console.error('[icon] failed to load', appIcon.getIconPath(variant));
    return false;
  }

  mainWindow.setIcon(image);
  return true;
}

const libraryWatcher = new LibraryWatcher(
  () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('library-changed');
    }
  },
  (paths) => {
    if (mainWindow && !mainWindow.isDestroyed() && Array.isArray(paths) && paths.length > 0) {
      mainWindow.webContents.send('library-paths-removed', paths);
    }
  },
);

mpvController.onStateChange = (state) => {
  playerWindows?.sendToControls('player-state', state);
  if (playerSession) {
    discordRpc.updatePlayback(playerSession, state);
  }
};

// Allow unmuted autoplay
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function getPlayerWindows() {
  if (!playerWindows) {
    playerWindows = new PlayerWindows(mainWindow, {
      isDev,
      preloadPath: path.join(__dirname, 'preload.cjs'),
      indexHtmlPath: path.join(__dirname, '../dist/index.html'),
    });
    // Closed by the OS (e.g. Alt+F4 on the controls window)
    playerWindows.onControlsClosed = () => { exitPlayer(null); };
  }
  return playerWindows;
}

let exiting = false;
async function exitPlayer(payload) {
  if (exiting) return;
  exiting = true;
  try {
    discordRpc.clear();
    await mpvController.close();
    playerWindows?.close();
    playerSession = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('player-exited', payload ?? null);
    }
  } finally {
    exiting = false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 810,
    minWidth: 800,
    minHeight: 400,
    backgroundColor: '#141414',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#141414',
      symbolColor: '#ffffff',
      height: TITLE_STRIP_HEIGHT,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // allow loading local files
    },
    icon: appIcon.loadWindowIcon(currentIconVariant) || appIcon.getIconPath('default'),
  });

  // Windows can reset the taskbar icon while the window is being shown
  mainWindow.once('ready-to-show', () => applyAppIcon(currentIconVariant));

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', () => {
    mpvController.close();
    playerWindows?.close();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    playerWindows = null;
    libraryWatcher.stop();
  });
}

app.on('before-quit', () => {
  mpvController.close();
  libraryWatcher.stop();
});

app.whenReady().then(() => {
  currentIconVariant = appIcon.loadVariant(app);

  // Register custom protocol to load local video files
  protocol.registerFileProtocol('local', (request, callback) => {
    const url = request.url.replace('local://', '');
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error('Failed to register protocol', error);
    }
  });

  discordRpc.init();
  createWindow();

  app.on('browser-window-focus', (_event, window) => {
    if (window === mainWindow && playerWindows?.isOpen()) {
      playerWindows.handleMainFocus();
    }
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

const { dialog, shell } = require('electron');

// IPC Handler to select folder natively
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// IPC Handler to select multiple folders
ipcMain.handle('select-folders', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled) return [];
  return result.filePaths;
});

function pickProfileImagePath() {
  return dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
  });
}

function ensureAvatarsDir() {
  const avatarsDir = path.join(app.getPath('userData'), 'avatars');
  if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
  }
  return avatarsDir;
}

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('pick-profile-image', async () => {
  const result = await pickProfileImagePath();
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('save-profile-image', async (_event, dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return null;

  const avatarsDir = ensureAvatarsDir();
  const destPath = path.join(avatarsDir, `${Date.now()}.jpg`);
  fs.writeFileSync(destPath, Buffer.from(match[1], 'base64'));
  return `file:///${destPath.replace(/\\/g, '/')}`;
});

// IPC Handler to pick and cache a profile image in userData (legacy, no crop)
ipcMain.handle('cache-profile-image', async () => {
  const result = await pickProfileImagePath();
  if (result.canceled) return null;

  const sourcePath = result.filePaths[0];
  const avatarsDir = ensureAvatarsDir();
  const ext = path.extname(sourcePath).toLowerCase() || '.jpg';
  const destPath = path.join(avatarsDir, `${Date.now()}${ext}`);
  fs.copyFileSync(sourcePath, destPath);

  return `file:///${destPath.replace(/\\/g, '/')}`;
});

ipcMain.handle('select-wallpaper-image', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
  });
  if (result.canceled) return null;

  const sourcePath = result.filePaths[0];
  const wallpapersDir = path.join(app.getPath('userData'), 'wallpapers');
  if (!fs.existsSync(wallpapersDir)) {
    fs.mkdirSync(wallpapersDir, { recursive: true });
  }

  const ext = path.extname(sourcePath).toLowerCase() || '.jpg';
  const destPath = path.join(wallpapersDir, `${Date.now()}${ext}`);
  fs.copyFileSync(sourcePath, destPath);

  return destPath;
});

ipcMain.handle('set-app-icon', async (_event, variant) => {
  const resolved = appIcon.normalizeVariant(variant);
  const windowIconOk = applyAppIcon(resolved);
  appIcon.saveVariant(app, resolved);

  const shortcutsUpdated = await appIcon.queueShortcutUpdate(app, resolved);

  return { ok: windowIconOk, shortcutsUpdated };
});

ipcMain.handle('get-app-icon-path', async (_event, variant) => {
  const iconPath = appIcon.getIconPath(appIcon.normalizeVariant(variant));
  if (!fs.existsSync(iconPath)) return null;
  return `file:///${iconPath.replace(/\\/g, '/')}`;
});

ipcMain.handle('update-library-watch', async (_event, folders) => {
  libraryWatcher.updateFolders(Array.isArray(folders) ? folders : []);
  return { ok: true };
});

ipcMain.handle('path-exists', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return false;
  try {
    return fs.existsSync(path.resolve(filePath));
  } catch {
    return false;
  }
});

ipcMain.handle('show-in-explorer', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') return { ok: false };
  try {
    const resolved = path.resolve(filePath);
    if (fs.existsSync(resolved)) {
      if (fs.statSync(resolved).isDirectory()) {
        await shell.openPath(resolved);
      } else {
        shell.showItemInFolder(resolved);
      }
      return { ok: true };
    }
    const parent = path.dirname(resolved);
    if (fs.existsSync(parent)) {
      await shell.openPath(parent);
      return { ok: true };
    }
    return { ok: false };
  } catch (err) {
    console.error('show-in-explorer failed:', err);
    return { ok: false };
  }
});

async function walkDirAsync(dir, filelist = []) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const filepath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDirAsync(filepath, filelist);
    } else {
      filelist.push(filepath);
    }
  }
  return filelist;
}

function isSeasonFolderName(segment) {
  if (!segment) return false;
  const s = segment.trim();
  return (
    /^(season\s*\d+|s\d+|specials?|extras?|ovas?|part\s*\d+|cour\s*\d+)$/i.test(s) ||
    /^(season|s)\s*\d+/i.test(s)
  );
}

// IPC Handler to scan directory
ipcMain.handle('scan-directory', async (event, dirPath) => {
  try {
    const fullPath = path.resolve(dirPath);
    if (!fs.existsSync(fullPath)) return [];

    const allFiles = await walkDirAsync(fullPath);

    const mediaFiles = allFiles.filter(filepath => {
      const ext = path.extname(filepath).toLowerCase();
      return ['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(ext);
    });

    return mediaFiles.map(filepath => {
      const file = path.basename(filepath);
      const dir = path.dirname(filepath);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(filepath).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      // Clean up pirate group tags like [AnimePahe], remove extension, and replace underscores with spaces
      let cleanName = file.replace(/\[.*?\]/g, '').trim(); // Remove brackets
      cleanName = path.basename(cleanName, path.extname(cleanName)); // Remove extension
      cleanName = cleanName.replace(/[_\.]+/g, ' ').trim(); // Replace underscores/dots with spaces
      // Sometimes it leaves leading hyphens like "- 01 1080p"
      cleanName = cleanName.replace(/^[-\s]+/, '');
      
      // Check for offline metadata/artwork
      const baseNoExt = path.basename(file, path.extname(file));
      const posterPath = path.join(dir, 'poster.jpg');
      const fanartPath = path.join(dir, 'fanart.jpg');
      const nfoPath = path.join(dir, `${baseNoExt}.nfo`);
      const movieNfoPath = path.join(dir, 'movie.nfo');
      
      const localPoster = fs.existsSync(posterPath) ? `file:///${posterPath.replace(/\\/g, '/')}` : null;
      const localFanart = fs.existsSync(fanartPath) ? `file:///${fanartPath.replace(/\\/g, '/')}` : null;
      
      let localNfoContent = null;
      if (fs.existsSync(nfoPath)) {
        localNfoContent = fs.readFileSync(nfoPath, 'utf8');
      } else if (fs.existsSync(movieNfoPath)) {
        localNfoContent = fs.readFileSync(movieNfoPath, 'utf8');
      }
      
      const scanRootName = path.basename(fullPath);
      const rel = path.relative(fullPath, filepath).replace(/\\/g, '/');
      const firstSegment = rel.includes('/') ? rel.split('/')[0] : '';
      const relativePath = !rel.includes('/') || isSeasonFolderName(firstSegment)
        ? `${scanRootName}/${rel}`
        : rel;

      return {
        name: cleanName || file, // Fallback to raw file if regex wipes it completely
        path: filepath,
        relativePath,
        folderName: dir !== fullPath ? path.basename(dir) : undefined,
        localPoster,
        localFanart,
        localNfoContent,
        mtimeMs,
      };
    });
  } catch (error) {
    console.error("Error scanning directory:", error);
    return [];
  }
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Executables', extensions: ['exe'] }]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('play-in-external-player', async (event, playerPath, videoPath) => {
  const { execFile } = require('child_process');
  
  // Custom arguments for VLC and PotPlayer to make them borderless/fullscreen
  let args = [videoPath];
  const playerLower = playerPath.toLowerCase();
  
  if (playerLower.includes('vlc.exe')) {
    args.push('--fullscreen', '--no-video-title-show', '--play-and-exit');
  } else if (playerLower.includes('potplayer')) {
    args.push('/fullscreen', '/close');
  }

  return new Promise((resolve, reject) => {
    execFile(playerPath, args, (error) => {
      if (error) {
        console.error('Failed to launch external player:', error);
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

// Probe audio codec via ffprobe
ipcMain.handle('probe-media', async (event, videoPath) => {
  return probeMediaAudio(videoPath);
});

ipcMain.handle('probe-media-duration', async (event, videoPath) => {
  return probeMediaDuration(videoPath);
});

// Probe all audio and subtitle tracks
ipcMain.handle('probe-tracks', async (event, videoPath) => {
  return probeTracks(videoPath);
});

// Find external subtitle files matching a video
ipcMain.handle('find-subtitle-files', async (event, videoPath) => {
  return findSubtitleFiles(videoPath);
});

// Native subtitle file picker
ipcMain.handle('select-subtitle-file', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openFile'],
    filters: [{
      name: 'Subtitles',
      extensions: ['srt', 'vtt', 'ass', 'ssa', 'sub'],
    }],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ---- Player ----
// Library window: player-start / onPlayerExited / onPlayerRequestNext
// Controls window: player-get-session / player-open / player-command / player-exit / ...

ipcMain.handle('player-start', async (event, session) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  playerSession = session;
  discordRpc.updatePlayback(session, mpvController.getState());
  const windows = getPlayerWindows();
  if (windows.isOpen()) {
    windows.sendToControls('player-session', session);
    windows.focusControls();
  } else {
    windows.open({ appName: session?.appName });
  }
  return { ok: true };
});

ipcMain.handle('player-get-session', async () => playerSession);

ipcMain.handle('player-open', async (event, filePath, options) => {
  try {
    const windows = getPlayerWindows();
    await mpvController.open(windows.getVideoHwnd(), filePath, options || {});
    return { ok: true, state: mpvController.getState() };
  } catch (err) {
    console.error('[player-open]', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('player-command', async (event, action, value) => {
  try {
    await mpvController.run(action, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('player-toggle-fullscreen', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return getPlayerWindows().setFullscreen(!mainWindow.isFullScreen());
});

ipcMain.handle('player-set-fullscreen', async (event, fullscreen) => {
  return getPlayerWindows().setFullscreen(Boolean(fullscreen));
});

ipcMain.handle('player-request-next', async (event, targetPath) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-request-next', targetPath || playerSession?.path || null);
  }
  return { ok: true };
});

ipcMain.handle('player-request-prev', async (event, targetPath) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-request-prev', targetPath || playerSession?.path || null);
  }
  return { ok: true };
});

ipcMain.handle('player-exit', async (event, payload) => {
  await exitPlayer(payload);
  return { ok: true };
});

ipcMain.handle('discord-rpc-set-enabled', (event, enabled) => {
  discordRpc.setEnabled(enabled);
  return { ok: true };
});

ipcMain.handle('discord-rpc-set-client-id', (event, clientId) => {
  discordRpc.setClientId(clientId);
  return { ok: true };
});

ipcMain.handle('discord-rpc-set-activity-style', (event, style) => {
  discordRpc.setActivityStyle(style);
  return { ok: true };
});

ipcMain.handle('online-search', async (_event, query) => {
  return searchOnline(query);
});
