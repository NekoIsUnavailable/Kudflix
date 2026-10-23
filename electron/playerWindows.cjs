const { BrowserWindow } = require('electron');
const { setWindowAbove } = require('./winZOrder.cjs');

// Height of the strip left uncovered so the main window's drag region and
// caption buttons (titleBarOverlay) stay usable during playback.
const TITLE_STRIP_HEIGHT = 32;

function playerWindowTitle(appName) {
  const name = (appName || '').trim() || 'Kudflix';
  return `${name} Player`;
}

/**
 * Playback uses a single overlay on top of the library UI:
 *
 *   mainWindow   - library UI (opaque)
 *   playerWindow - transparent; mpv renders into it via --wid and the React
 *                  player controls are drawn over the video
 *
 * Why this shape, since every part of it is load-bearing:
 *
 * `transparent: true` is mandatory. mpv's --wid window is a child HWND, and a
 * child HWND paints into its parent's DWM surface where Chromium's render
 * widget - a higher z-order sibling - overwrites it. Transparency is what stops
 * Chromium from putting opaque pixels there; make this window opaque and the
 * video turns grey. Being the higher sibling is also why the controls draw on
 * top of the video and keep receiving mouse input.
 *
 * That same trap rules out drawing video in mainWindow, which must stay opaque.
 *
 * The window is also the share target for Discord/OBS, because capturing
 * mainWindow misses the video entirely. Chromium's window enumeration skips
 * anything owned, untitled, or flagged as a tool window:
 *
 *   if (owner && !(exstyle & WS_EX_APPWINDOW)) return TRUE;
 *
 * so it carries a title, takes no `parent`, and stays focusable (Electron
 * forces skipTaskbar on non-focusable windows). It must never call
 * setIgnoreMouseEvents(), which adds WS_EX_TRANSPARENT | WS_EX_LAYERED and
 * marks it as a click-through overlay that pickers skip. Taking no `parent`
 * costs automatic z-order above mainWindow, which handleMainFocus restores.
 *
 * Z-order vs other apps (windowed): the player is NOT globally always-on-top.
 * On Windows, SetWindowPos places the player HWND directly above mainWindow so
 * other apps can cover the player when focused. Fullscreen playback still uses
 * a stronger always-on-top level to avoid the taskbar/refocus glitches.
 */
class PlayerWindows {
  constructor(mainWindow, { isDev, preloadPath, indexHtmlPath }) {
    this.mainWindow = mainWindow;
    this.isDev = isDev;
    this.preloadPath = preloadPath;
    this.indexHtmlPath = indexHtmlPath;
    this.playerWindow = null;
    this.onControlsClosed = null;
    this.syncBounds = this.syncBounds.bind(this);
    this.handleMinimize = this.handleMinimize.bind(this);
    this.handleRestore = this.handleRestore.bind(this);
    this.handleMainFocus = this.handleMainFocus.bind(this);
    this.handlePlayerBlur = this.handlePlayerBlur.bind(this);
    this.handleLeaveFullscreen = this.handleLeaveFullscreen.bind(this);
    this.handleWindowPlacementChange = this.handleWindowPlacementChange.bind(this);
    this.scheduleRestoreStack = this.scheduleRestoreStack.bind(this);
  }

  /** Windows reorders HWNDs when leaving fullscreen; retry until player sits above main again. */
  scheduleRestoreStack() {
    if (!this.isOpen()) return;
    const run = () => this.restorePlayerStack();
    run();
    setImmediate(run);
    setTimeout(run, 0);
    setTimeout(run, 50);
    setTimeout(() => {
      run();
      if (!this.isOpen() || this.mainWindow.isDestroyed()) return;
      if (!this.isFullscreenPlayback()) {
        this.playerWindow.show();
        this.raisePlayerAboveMain();
        this.playerWindow.focus();
      }
    }, 150);
  }

  handleLeaveFullscreen() {
    if (!this.isOpen()) return;
    this.scheduleRestoreStack();
  }

  isOpen() {
    return Boolean(this.playerWindow && !this.playerWindow.isDestroyed());
  }

  getTargetBounds() {
    const bounds = this.mainWindow.getContentBounds();
    if (this.mainWindow.isFullScreen()) return bounds;
    return {
      x: bounds.x,
      y: bounds.y + TITLE_STRIP_HEIGHT,
      width: bounds.width,
      height: Math.max(1, bounds.height - TITLE_STRIP_HEIGHT),
    };
  }

  isFullscreenPlayback() {
    if (!this.isOpen() || this.mainWindow.isDestroyed()) return false;
    return this.mainWindow.isFullScreen() || this.playerWindow.isFullScreen();
  }

  syncAlwaysOnTopLevel() {
    if (!this.isOpen()) return;
    if (this.isFullscreenPlayback()) {
      // Stronger level in fullscreen so refocusing the library window (taskbar click,
      // alt-tab) does not paint it over the player HWND on Windows.
      this.playerWindow.setAlwaysOnTop(true, 'screen-saver');
      return;
    }
    this.playerWindow.setAlwaysOnTop(false);
  }

  raisePlayerAboveMain() {
    if (!this.isOpen() || this.mainWindow.isDestroyed()) return;
    this.syncAlwaysOnTopLevel();
    if (this.isFullscreenPlayback()) {
      this.playerWindow.moveTop();
      return;
    }
    const stacked = setWindowAbove(this.playerWindow, this.mainWindow);
    if (!stacked) {
      // Non-Windows or SetWindowPos unavailable: fall back to previous global top behavior.
      this.playerWindow.setAlwaysOnTop(true, 'floating');
      this.playerWindow.moveTop();
    }
  }

  /** Re-stack player after main window steals focus (common when re-activating the app). */
  restorePlayerStack() {
    if (!this.isOpen() || this.mainWindow.isDestroyed()) return;
    this.syncBounds();
    this.raisePlayerAboveMain();
    if (this.mainWindow.isFullScreen()) {
      this.playerWindow.focus();
    }
  }

  applyPlayerFullscreen(isFullscreen) {
    if (!this.isOpen()) return;
    if (isFullscreen) {
      // The player window receives focus when pausing/scrubbing. If only mainWindow
      // is fullscreen, Windows treats the focused player as windowed and shows the
      // taskbar, so both windows must enter fullscreen together.
      if (!this.playerWindow.isFullScreen()) {
        this.playerWindow.setFullScreen(true);
      }
    } else if (this.playerWindow.isFullScreen()) {
      this.playerWindow.setFullScreen(false);
      this.playerWindow.setBounds(this.getTargetBounds());
    } else {
      this.playerWindow.setBounds(this.getTargetBounds());
    }
    this.syncAlwaysOnTopLevel();
    if (!this.playerWindow.isVisible()) this.playerWindow.show();
    this.raisePlayerAboveMain();
    this.playerWindow.webContents.send('player-fullscreen', isFullscreen);
  }

  syncBounds() {
    if (!this.isOpen() || this.mainWindow.isDestroyed()) return;
    this.applyPlayerFullscreen(this.mainWindow.isFullScreen());
  }

  handleMinimize() {
    this.playerWindow?.hide();
  }

  handleRestore() {
    this.handleWindowPlacementChange();
  }

  /** Maximize, restore from taskbar, unmaximize — resync bounds and restack player above main. */
  handleWindowPlacementChange() {
    if (!this.isOpen()) return;
    if (this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isMinimized()) {
      this.playerWindow?.hide();
      return;
    }
    this.syncBounds();
    if (!this.playerWindow.isDestroyed()) {
      this.playerWindow.show();
    }
    this.scheduleRestoreStack();
  }

  /**
   * Without an owner relationship, raising mainWindow (clicking its title strip,
   * alt-tabbing to it) would bury the player behind the library UI.
   */
  handleMainFocus() {
    if (!this.isOpen()) return;
    this.restorePlayerStack();
    // Focus lands on main first when clicking the taskbar; defer so we run after WM finishes.
    setImmediate(() => this.restorePlayerStack());
  }

  handlePlayerBlur() {
    if (!this.isOpen() || this.mainWindow.isDestroyed()) return;
    if (this.mainWindow.isFocused()) {
      setImmediate(() => this.scheduleRestoreStack());
    }
  }

  open(options = {}) {
    if (this.isOpen()) {
      this.syncBounds();
      return;
    }

    const title = playerWindowTitle(options.appName);

    this.playerWindow = new BrowserWindow({
      ...this.getTargetBounds(),
      // No `parent`: an owned window is filtered out of share pickers and
      // Windows refuses it a taskbar button.
      title,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: true,
      // focusable: false would force skipTaskbar on, hiding it from pickers.
      focusable: true,
      skipTaskbar: false,
      show: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false,
      },
    });

    // The React app's document title would otherwise replace the window title
    // and change what shows up in share pickers mid-session.
    this.playerWindow.on('page-title-updated', (event) => event.preventDefault());

    if (this.isDev) {
      this.playerWindow.loadURL('http://localhost:5173/?player=1');
    } else {
      this.playerWindow.loadFile(this.indexHtmlPath, { query: { player: '1' } });
    }
    this.playerWindow.setTitle(title);

    this.syncAlwaysOnTopLevel();

    this.playerWindow.once('ready-to-show', () => {
      if (!this.isOpen()) return;
      this.syncBounds();
      this.playerWindow.setTitle(title);
      this.playerWindow.show();
      this.raisePlayerAboveMain();
      this.playerWindow.focus();
    });

    this.playerWindow.on('blur', this.handlePlayerBlur);
    this.playerWindow.on('leave-full-screen', this.handleLeaveFullscreen);

    this.mainWindow.on('leave-full-screen', this.handleLeaveFullscreen);

    this.playerWindow.on('closed', () => {
      this.playerWindow = null;
      if (this.onControlsClosed) this.onControlsClosed();
    });

    this.mainWindow.on('resize', this.syncBounds);
    this.mainWindow.on('move', this.syncBounds);
    this.mainWindow.on('enter-full-screen', this.syncBounds);
    this.mainWindow.on('leave-full-screen', this.syncBounds);
    this.mainWindow.on('maximize', this.handleWindowPlacementChange);
    this.mainWindow.on('unmaximize', this.handleWindowPlacementChange);
    this.mainWindow.on('minimize', this.handleMinimize);
    this.mainWindow.on('restore', this.handleWindowPlacementChange);
    this.mainWindow.on('focus', this.handleMainFocus);
    this.mainWindow.on('show', this.handleMainFocus);
  }

  /** HWND mpv embeds into via --wid. */
  getVideoHwnd() {
    if (!this.isOpen()) throw new Error('Player window is not open');
    const handle = this.playerWindow.getNativeWindowHandle();
    return handle.length >= 8 ? handle.readBigInt64LE(0).toString() : String(handle.readInt32LE(0));
  }

  sendToControls(channel, payload) {
    if (this.isOpen()) this.playerWindow.webContents.send(channel, payload);
  }

  focusControls() {
    if (this.isOpen()) this.playerWindow.focus();
  }

  setFullscreen(fullscreen) {
    if (this.mainWindow.isDestroyed()) return false;
    this.mainWindow.setFullScreen(fullscreen);
    this.applyPlayerFullscreen(fullscreen);
    return fullscreen;
  }

  close() {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.removeListener('resize', this.syncBounds);
      this.mainWindow.removeListener('move', this.syncBounds);
      this.mainWindow.removeListener('enter-full-screen', this.syncBounds);
      this.mainWindow.removeListener('leave-full-screen', this.syncBounds);
      this.mainWindow.removeListener('maximize', this.handleWindowPlacementChange);
      this.mainWindow.removeListener('unmaximize', this.handleWindowPlacementChange);
      this.mainWindow.removeListener('minimize', this.handleMinimize);
      this.mainWindow.removeListener('restore', this.handleWindowPlacementChange);
      this.mainWindow.removeListener('focus', this.handleMainFocus);
      this.mainWindow.removeListener('show', this.handleMainFocus);
      this.mainWindow.removeListener('leave-full-screen', this.handleLeaveFullscreen);
      if (this.mainWindow.isFullScreen()) this.mainWindow.setFullScreen(false);
    }

    const player = this.playerWindow;
    this.playerWindow = null;
    if (player && !player.isDestroyed()) {
      if (player.isFullScreen()) player.setFullScreen(false);
      player.removeListener('blur', this.handlePlayerBlur);
      player.removeListener('leave-full-screen', this.handleLeaveFullscreen);
      player.setAlwaysOnTop(false);
      player.removeAllListeners('closed');
      player.destroy();
    }

    if (!this.mainWindow.isDestroyed()) this.mainWindow.focus();
  }
}

module.exports = { PlayerWindows, TITLE_STRIP_HEIGHT };
