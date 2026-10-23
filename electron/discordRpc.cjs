const RPC = require('discord-rpc');

const DEFAULT_CLIENT_ID = '737663962677510245';

class DiscordRpcManager {
  constructor() {
    this.client = null;
    this.clientId = DEFAULT_CLIENT_ID;
    this.enabled = true;
    this.connected = false;
    this.connecting = false;
    this.currentActivity = null;
    this.reconnectTimer = null;
    this.lastState = null;
    this.lastSession = null;
    this.activityStyle = 'watching'; // 'media' (type 2 - scrubber timeline), 'watching' (type 3), 'playing' (type 0)
  }

  init(clientId) {
    if (clientId) {
      this.clientId = clientId;
    }
    this.connect();
  }

  setActivityStyle(style) {
    if (['media', 'watching', 'playing'].includes(style)) {
      this.activityStyle = style;
      if (this.lastSession && this.lastState) {
        this.updatePlayback(this.lastSession, this.lastState);
      }
    }
  }

  connect() {
    if (!this.enabled || this.connected || this.connecting) return;
    this.connecting = true;

    try {
      this.client = new RPC.Client({ transport: 'ipc' });

      this.client.on('ready', () => {
        this.connected = true;
        this.connecting = false;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        if (this.currentActivity) {
          this.applyActivity(this.currentActivity);
        }
      });

      this.client.on('disconnected', () => {
        this.connected = false;
        this.connecting = false;
        this.scheduleReconnect();
      });

      this.client.login({ clientId: this.clientId }).catch(() => {
        this.connected = false;
        this.connecting = false;
        this.scheduleReconnect();
      });
    } catch {
      this.connected = false;
      this.connecting = false;
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer || !this.enabled) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 20000); // retry every 20s if Discord was closed
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.clear();
      if (this.client) {
        try {
          this.client.destroy();
        } catch {
          // ignore
        }
        this.client = null;
        this.connected = false;
      }
    } else {
      this.connect();
    }
  }

  setClientId(clientId) {
    const id = clientId?.trim() || DEFAULT_CLIENT_ID;
    if (id !== this.clientId) {
      this.clientId = id;
      if (this.client) {
        try {
          this.client.destroy();
        } catch {
          // ignore
        }
        this.client = null;
        this.connected = false;
      }
      this.connect();
    }
  }

  updatePlayback(session, state) {
    if (!session) {
      this.clear();
      return;
    }

    this.lastSession = session;
    this.lastState = state;

    if (!this.enabled) return;

    const clip = (value) => (value.length > 128 ? value.slice(0, 125) + '...' : value);
    const title = clip(session.title || 'Video');
    const subtitle = clip(session.subtitle || (session.isFolder ? 'TV Series' : 'Movie'));
    const isPaused = Boolean(state?.pause);

    // Pick large image: if session has an online thumbnail (http/https), Discord's media proxy will render it!
    const hasOnlineThumb = typeof session.thumbnail === 'string' && /^https?:\/\//i.test(session.thumbnail);
    const largeImage = hasOnlineThumb ? session.thumbnail : 'mpv';

    // Type 3 (Watching) and type 2 (Listening) both show a progress bar when start+end timestamps are set.
    let activityType = 3;
    if (this.activityStyle === 'media') activityType = 2;
    if (this.activityStyle === 'playing') activityType = 0;

    const activity = {
      type: activityType,
      name: title,
      details: title,
      state: isPaused ? `${subtitle} (Paused)` : subtitle,
      largeImageKey: largeImage,
      largeImageText: title,
      instance: false,
    };

    // Unix epoch timestamps in SECONDS
    if (!isPaused && state?.duration && state.duration > 0 && typeof state?.timePos === 'number') {
      const now = Math.floor(Date.now() / 1000);
      const currentSec = Math.floor(state.timePos);
      const durationSec = Math.floor(state.duration);
      activity.startTimestamp = now - currentSec;
      activity.endTimestamp = now + (durationSec - currentSec);
    }

    this.currentActivity = activity;
    this.applyActivity(activity);
  }

  applyActivity(activity) {
    if (!this.connected || !this.client || !this.enabled) return;
    try {
      const pid = process.pid;
      const timestamps = (activity.startTimestamp || activity.endTimestamp) ? {
        start: activity.startTimestamp,
        end: activity.endTimestamp,
      } : undefined;

      const assets = activity.largeImageKey ? {
        large_image: activity.largeImageKey,
        large_text: activity.largeImageText,
      } : undefined;

      // Send directly via request('SET_ACTIVITY') so activity.type is preserved
      this.client.request('SET_ACTIVITY', {
        pid,
        activity: {
          type: typeof activity.type === 'number' ? activity.type : 3,
          name: activity.name || activity.details,
          details: activity.details,
          state: activity.state,
          timestamps,
          assets,
          instance: false,
        },
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  clear() {
    this.currentActivity = null;
    this.lastSession = null;
    this.lastState = null;
    if (this.connected && this.client) {
      try {
        this.client.request('SET_ACTIVITY', { pid: process.pid }).catch(() => {});
      } catch {
        // ignore
      }
    }
  }
}

const discordRpc = new DiscordRpcManager();

module.exports = { discordRpc };
