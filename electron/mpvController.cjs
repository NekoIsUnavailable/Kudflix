const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const STATE_EMIT_INTERVAL_MS = 200;
const MPV_VOLUME_MAX = 150;

function clampMpvVolume(value) {
  return Math.max(0, Math.min(MPV_VOLUME_MAX, Math.round(Number(value) || 0)));
}

/** Scene/Plex-style release names: `.DV.HEVC`, `.DoVi.HDR`, etc. */
function isDolbyVisionRelease(filePath) {
  const name = path.basename(filePath || '');
  return /\.(?:DV|DoVi)(?:\.|[._-]|$)/i.test(name);
}

/** VO / hwdec flags tuned for embedded --wid playback (Windows compositing is picky). */
function mpvRenderArgs(filePath) {
  // gpu-next (libplacebo) handles HDR10 / Dolby Vision tone mapping; legacy gpu + DV often tints green.
  const args = ['--vo=gpu-next'];
  if (process.platform === 'win32') {
    args.push('--gpu-context=d3d11');
    const forceSw =
      process.env.KUDFLIX_MPV_HWDEC === 'no' || isDolbyVisionRelease(filePath);
    // D3D11 VA on some HEVC DV rips skips RPU reshaping → green/purple; SW decode fixes that.
    args.push(forceSw ? '--hwdec=no' : '--hwdec=d3d11va-copy');
  } else {
    args.push('--hwdec=auto-copy');
  }
  return args;
}

/** Map HDR / DV (e.g. NF WEB-DL HEVC) to SDR for the non-HDR Electron player surface. */
function mpvSdrOutputArgs(filePath) {
  const dolbyVision = isDolbyVisionRelease(filePath);
  const peakOverride = process.env.KUDFLIX_MPV_TARGET_PEAK;
  const targetPeak =
    peakOverride && /^\d+$/.test(peakOverride) ? peakOverride : '203';

  const args = [
    // bt.2446a can tint DV P5 green; spline holds contrast well on other HDR.
    dolbyVision ? '--tone-mapping=bt.2390' : '--tone-mapping=spline',
    '--hdr-compute-peak=yes',
    '--hdr-contrast-recovery=0.45',
    '--tone-mapping-max-boost=1.15',
    // Tone-map luminance to SDR; squeezing into bt.709 gamut reads flat/washed on most rips.
    '--gamut-mapping-mode=clip',
    '--target-prim=bt.2020',
    '--target-trc=bt.1886',
    `--target-peak=${targetPeak}`,
    '--target-colorspace-hint=auto',
    '--target-colorspace-hint-mode=target',
    // Full-range SDR plays nicer with DWM + embedded rgba swap chains than TV limited.
    '--video-output-levels=full',
    '--inverse-tone-mapping=no',
    '--sdr-adjust-gamma=auto',
  ];
  return args;
}

/** Scaling, banding, and display calibration (after SDR/color args so tone map settings win). */
function mpvQualityArgs() {
  return [
    '--profile=gpu-hq',
    '--deband',
    '--deband-iterations=2',
    '--icc-profile-auto',
    '--dither=error-diffusion',
  ];
}

const OBSERVED_PROPERTIES = [
  'time-pos',
  'duration',
  'pause',
  'volume',
  'mute',
  'speed',
  'paused-for-cache',
  'seeking',
  'eof-reached',
  'track-list',
  'aid',
];

function getMpvExecutablePath() {
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'mpv', 'mpv.exe')
    : path.join(__dirname, 'bin', 'mpv', 'mpv.exe');
  return fs.existsSync(bundled) ? bundled : 'mpv';
}

function getYtDlpExecutablePath() {
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'mpv', 'yt-dlp.exe')
    : path.join(__dirname, 'bin', 'mpv', 'yt-dlp.exe');
  return fs.existsSync(bundled) ? bundled : null;
}

function initialState() {
  return {
    timePos: 0,
    duration: 0,
    pause: false,
    volume: 100,
    mute: false,
    speed: 1,
    buffering: true,
    seeking: false,
    eof: false,
    loaded: false,
    error: null,
    tracks: [],
    audioId: null,
  };
}

class MpvController {
  constructor() {
    this.process = null;
    this.socket = null;
    this.requestId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.state = initialState();
    this.onStateChange = null;
    this.lastEmit = 0;
    this.emitTimer = null;
    this.expectingExit = false;
    this.resumeAfterLoad = null;
    this.currentHwnd = null;
  }

  emit(immediate = false) {
    if (!this.onStateChange) return;
    const now = Date.now();
    const elapsed = now - this.lastEmit;

    if (immediate || elapsed >= STATE_EMIT_INTERVAL_MS) {
      if (this.emitTimer) {
        clearTimeout(this.emitTimer);
        this.emitTimer = null;
      }
      this.lastEmit = now;
      this.onStateChange({ ...this.state });
      return;
    }

    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        this.lastEmit = Date.now();
        this.onStateChange?.({ ...this.state });
      }, STATE_EMIT_INTERVAL_MS - elapsed);
    }
  }

  async open(hwnd, filePath, options = {}) {
    // If mpv is already running in this window, switch to the new file via IPC
    // without destroying and respawning the process/HWND/swapchain.
    if (this.process && this.socket && !this.socket.destroyed && this.currentHwnd === hwnd) {
      try {
        this.fileLoadFinished = false;
        this.resumeAfterLoad =
          options.startTime && options.startTime > 0 ? options.startTime : null;
        this.state.loaded = false;
        this.state.buffering = true;
        this.state.timePos = 0;
        this.state.duration = 0;
        this.state.eof = false;
        this.state.error = null;
        this.emit(true);

        if (options.volume != null) {
          await this.setProperty('volume', Math.max(0, Math.min(100, options.volume))).catch(() => {});
        }
        if (options.mute != null) {
          await this.setProperty('mute', Boolean(options.mute)).catch(() => {});
        }
        if (options.subtitleId === 'no') {
          await this.setProperty('sid', 'no').catch(() => {});
        } else if (typeof options.subtitleId === 'number') {
          await this.setProperty('sid', options.subtitleId).catch(() => {});
        }

        await this.command(['loadfile', filePath, 'replace']);

        setTimeout(async () => {
          try {
            const dur = await this.getProperty('duration');
            if (typeof dur === 'number' && dur > 0) {
              this.state.duration = dur;
              void this.finishFileLoad();
            }
          } catch {
            // will fire via property change or file-loaded
          }
        }, 50);

        return;
      } catch (err) {
        console.warn('[mpv] fast loadfile failed, falling back to full spawn:', err);
      }
    }

    await this.close();

    this.currentHwnd = hwnd;
    this.state = initialState();
    this.state.volume = options.volume ?? 100;
    this.expectingExit = false;
    this.fileLoadFinished = false;
    this.resumeAfterLoad =
      options.startTime && options.startTime > 0 ? options.startTime : null;

    const pipeName = `\\\\.\\pipe\\kudflix-mpv-${process.pid}-${Date.now()}`;
    const args = [
      `--wid=${hwnd}`,
      '--no-config',
      '--no-osc',
      '--no-osd-bar',
      '--osd-level=0',
      '--no-input-default-bindings',
      '--input-vo-keyboard=no',
      '--no-input-cursor',
      '--cursor-autohide=no',
      '--keep-open=yes',
      '--idle=yes',
      '--force-window=yes',
      ...mpvRenderArgs(filePath),
      ...mpvSdrOutputArgs(filePath),
      ...mpvQualityArgs(),
      '--background-color=#000000',
      '--hr-seek=yes',
      '--cache=yes',
      '--demuxer-max-bytes=150MiB',
      // Netflix-like subtitle styling; force overrides embedded ASS/SRT styles
      '--sub-ass-override=force',
      '--sub-font=Arial',
      '--sub-font-size=36',
      '--sub-bold=yes',
      '--sub-border-size=2.5',
      '--sub-border-color=#FF000000',
      '--sub-shadow-offset=1.5',
      '--sub-shadow-color=#99000000',
      '--sub-margin-y=48',
      '--sub-auto=no',
      `--input-ipc-server=${pipeName}`,
      `--volume-max=${MPV_VOLUME_MAX}`,
      `--volume=${clampMpvVolume(options.volume ?? 100)}`,
    ];

    const ytDlpPath = getYtDlpExecutablePath();
    if (ytDlpPath) {
      args.push(`--script-opts=ytdl_hook-ytdl_path=${ytDlpPath}`);
    }

    if (options.mute) {
      args.push('--mute=yes');
    }
    if (options.startTime && options.startTime > 0) {
      args.push(`--start=${options.startTime.toFixed(2)}`);
    }
    if (options.subtitleId === 'no') {
      args.push('--sid=no');
    } else if (typeof options.subtitleId === 'number') {
      args.push(`--sid=${options.subtitleId}`);
    }

    args.push('--', filePath);

    const mpvPath = getMpvExecutablePath();
    const child = spawn(mpvPath, args, { windowsHide: true, stdio: 'ignore' });
    this.process = child;

    child.on('error', (err) => {
      console.error('[mpv] spawn error:', err);
      this.state.error = mpvPath === 'mpv'
        ? 'mpv was not found. Run "npm run setup-mpv" to download it.'
        : `Could not start mpv: ${err.message}`;
      this.emit(true);
    });

    child.on('exit', (code) => {
      if (this.process === child) {
        this.process = null;
        this.socket = null;
        if (!this.expectingExit) {
          this.state.error = `The player stopped unexpectedly (code ${code}).`;
          this.emit(true);
        }
      }
    });

    await this.connect(pipeName, child);

    if (options.subtitleStyle) {
      await this.applySubtitleStyle(options.subtitleStyle).catch(() => {});
    }

    let id = 1;
    for (const prop of OBSERVED_PROPERTIES) {
      this.command(['observe_property', id++, prop]).catch(() => {});
    }

    // Guard against race condition: if file already loaded before IPC connection completed
    try {
      const dur = await this.command(['get_property', 'duration']).catch(() => null);
      if (typeof dur === 'number' && dur > 0 && !this.fileLoadFinished) {
        void this.finishFileLoad();
      }
    } catch {
      // file-loaded or onProperty will catch it
    }

    this.emit(true);
  }

  connect(pipeName, child) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 8000;

      const attempt = () => {
        if (this.process !== child) {
          reject(new Error('Player was closed while starting'));
          return;
        }
        const socket = net.connect(pipeName);
        socket.once('connect', () => {
          socket.setEncoding('utf8');
          socket.on('data', (chunk) => this.onData(chunk));
          socket.on('error', () => {});
          socket.on('close', () => {
            if (this.socket === socket) this.socket = null;
          });
          this.socket = socket;
          resolve();
        });
        socket.once('error', () => {
          socket.destroy();
          if (Date.now() > deadline) {
            reject(new Error('Timed out connecting to mpv'));
          } else {
            setTimeout(attempt, 50);
          }
        });
      };

      attempt();
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        this.onMessage(JSON.parse(line));
      } catch {
        // ignore malformed line
      }
    }
  }

  onMessage(msg) {
    if (msg.request_id !== undefined && this.pending.has(msg.request_id)) {
      const { resolve, reject, timer } = this.pending.get(msg.request_id);
      clearTimeout(timer);
      this.pending.delete(msg.request_id);
      if (msg.error === 'success') resolve(msg.data);
      else reject(new Error(msg.error || 'mpv command failed'));
      return;
    }

    if (msg.event === 'property-change') {
      this.onProperty(msg.name, msg.data);
    } else if (msg.event === 'file-loaded') {
      void this.finishFileLoad();
    } else if (msg.event === 'end-file' && msg.reason === 'error') {
      this.state.error = 'This file could not be played.';
      this.emit(true);
    }
  }

  async finishFileLoad() {
    if (this.fileLoadFinished) return;
    this.fileLoadFinished = true;

    const resume = this.resumeAfterLoad;
    this.resumeAfterLoad = null;

    try {
      if (resume != null && resume > 0) {
        // CLI --start can leave embedded video (wid) stuck on a still frame until a seek;
        // re-seek after load refreshes decoding and A/V sync.
        await this.command(['seek', resume, 'absolute+exact']);
      } else {
        const pos = await this.getProperty('time-pos').catch(() => 0);
        if (typeof pos === 'number' && pos > 2) {
          await this.command(['seek', 0, 'absolute+exact']);
        }
      }
      await this.setProperty('pause', false);
    } catch (err) {
      console.warn('[mpv] post-load resume failed:', err);
    }

    this.state.loaded = true;
    this.state.buffering = false;
    this.emit(true);
  }

  onProperty(name, value) {
    const s = this.state;
    let immediate = true;

    switch (name) {
      case 'time-pos':
        if (typeof value === 'number' && Number.isFinite(value)) {
          s.timePos = value;
          if (!this.fileLoadFinished && value > 0) void this.finishFileLoad();
        }
        immediate = false;
        break;
      case 'duration':
        if (typeof value === 'number' && Number.isFinite(value)) {
          s.duration = value;
          if (!this.fileLoadFinished && value > 0) void this.finishFileLoad();
        }
        break;
      case 'pause':
        s.pause = Boolean(value);
        break;
      case 'volume':
        if (typeof value === 'number') s.volume = value;
        break;
      case 'mute':
        s.mute = Boolean(value);
        break;
      case 'speed':
        if (typeof value === 'number') s.speed = value;
        break;
      case 'paused-for-cache':
        s.buffering = Boolean(value);
        break;
      case 'seeking':
        s.seeking = Boolean(value);
        break;
      case 'eof-reached':
        s.eof = Boolean(value);
        break;
      case 'track-list':
        if (Array.isArray(value)) s.tracks = value;
        break;
      case 'aid':
        if (typeof value === 'number' && Number.isFinite(value)) {
          s.audioId = value;
        } else if (value === 'no' || value === null || value === undefined) {
          s.audioId = null;
        }
        break;
      default:
        return;
    }
    this.emit(immediate);
  }

  command(cmd) {
    if (!this.socket) return Promise.reject(new Error('Player is not running'));
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('mpv did not respond'));
      }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ command: cmd, request_id: requestId }) + '\n');
    });
  }

  setProperty(name, value) {
    return this.command(['set_property', name, value]);
  }

  getProperty(name) {
    return this.command(['get_property', name]);
  }

  async switchAudioTrack(id) {
    const trackId = Number(id);
    if (!Number.isFinite(trackId)) {
      throw new Error('Invalid audio track id');
    }
    const audioTracks = (this.state.tracks || []).filter((t) => t.type === 'audio');
    if (!audioTracks.some((t) => t.id === trackId)) {
      throw new Error('Audio track is not available');
    }
    await this.setProperty('aid', trackId);
    try {
      await this.setProperty('audio-channels', 'auto');
    } catch {
      // optional recovery
    }
    await this.setProperty('mute', false);
    await this.setProperty('volume', clampMpvVolume(this.state.volume ?? 100));
    return undefined;
  }

  async run(action, value) {
    switch (action) {
      case 'toggle-pause': return this.command(['cycle', 'pause']);
      case 'play': return this.setProperty('pause', false);
      case 'pause': return this.setProperty('pause', true);
      case 'seek': return this.command(['seek', value, 'relative+exact']);
      case 'seek-absolute': return this.command(['seek', value, 'absolute+exact']);
      case 'volume': return this.setProperty('volume', clampMpvVolume(value));
      case 'mute': return this.setProperty('mute', Boolean(value));
      case 'speed': return this.setProperty('speed', value);
      case 'audio-track': return this.switchAudioTrack(value);
      case 'subtitle-track': return this.setProperty('sid', value === null ? 'no' : value);
      case 'add-subtitle': return this.command(['sub-add', value.path, value.select ? 'select' : 'auto']);
      case 'subtitle-style': return this.applySubtitleStyle(value);
      default: throw new Error(`Unknown player action: ${action}`);
    }
  }

  async applySubtitleStyle(style = {}) {
    // Default mpv override mode ("scale") ignores most runtime style changes
    await this.setProperty('sub-ass-override', 'force');
    if (style.scale != null) await this.setProperty('sub-scale', style.scale);
    await this.setProperty('sub-font-size', style.fontSize ?? 36);
    await this.setProperty('sub-color', style.color ?? '#FFFFFFFF');
    await this.setProperty('sub-margin-y', style.marginY ?? 48);
    await this.setProperty('sub-border-size', style.borderSize ?? 2.5);
    await this.setProperty('sub-border-color', '#FF000000');
    await this.setProperty('sub-back-color', style.backColor ?? '#00000000');
    if (style.shadowOffset != null) await this.setProperty('sub-shadow-offset', style.shadowOffset);
    return undefined;
  }

  getState() {
    return { ...this.state };
  }

  async close() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error('Player closed'));
    }
    this.pending.clear();
    this.buffer = '';

    const child = this.process;
    if (!child) return;

    this.expectingExit = true;
    const exited = new Promise((resolve) => {
      child.once('exit', resolve);
      setTimeout(resolve, 1500);
    });

    if (this.socket) {
      this.socket.write(JSON.stringify({ command: ['quit'] }) + '\n');
    } else {
      child.kill();
    }

    await exited;
    if (child.exitCode === null) child.kill();

    this.socket?.destroy();
    this.socket = null;
    this.process = null;
    this.resumeAfterLoad = null;
    this.currentHwnd = null;
  }
}

module.exports = { MpvController, getMpvExecutablePath };
