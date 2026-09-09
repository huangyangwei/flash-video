// mpegts.js 播放器封装：最小缓冲配置 + 追帧循环 + 断流看门狗
import mpegts from 'mpegts.js';
import { decideAction, getWatermarkMs, ACTION } from './lib/catchup.js';

// design.md D2：enableStashBuffer:false + stashInitialSize:384 为官方低延迟推荐值；
// 内置 liveBufferLatencyChasing 关掉——追帧由我们自己的三旋钮引擎负责（design D3）
export const PLAYER_CONFIG = {
  enableStashBuffer: false,
  stashInitialSize: 384,
  lazyLoad: false,
  liveBufferLatencyChasing: false,
  autoCleanupSourceBuffer: true,
  enableWorker: true,
};

// 看门狗：readyState 低于 HAVE_FUTURE_DATA 且缓冲末端超过这么久没增长 -> 判定断流
const STALL_TIMEOUT_MS = 15000;
const TICK_INTERVAL_MS = 250;

export function isFlvUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      u.pathname.toLowerCase().endsWith('.flv')
    );
  } catch {
    return false;
  }
}

export class LowLatencyPlayer {
  constructor(videoEl, { onWatermark, onAction, onError, onStall } = {}) {
    this.videoEl = videoEl;
    this.mpegtsPlayer = null;
    this.settings = null;
    this.prevAction = ACTION.NORMAL;
    this.timerId = null;
    // 看门狗状态：上一次观察到的缓冲末端时间戳
    this.lastBufferedEnd = null;
    this.lastBufferedEndTime = Date.now();
    this.callbacks = { onWatermark, onAction, onError, onStall };
    this._boundVideoError = (e) =>
      this.callbacks.onError?.(`视频元素错误: ${e.message || 'unknown'}`);
    videoEl.addEventListener('error', this._boundVideoError);
  }

  start(url, settings) {
    this.stop();
    this.settings = settings;
    this.lastBufferedEnd = null;
    this.lastBufferedEndTime = Date.now();

    if (!mpegts.getFeatureList().mseLivePlayback) {
      this.callbacks.onError?.('当前浏览器不支持 MSE 直播播放');
      return false;
    }

    this.mpegtsPlayer = mpegts.createPlayer(
      { type: 'flv', isLive: true, url },
      PLAYER_CONFIG
    );
    this.mpegtsPlayer.attachMediaElement(this.videoEl);
    this.videoEl.muted = true; // 音频默认静音（spec: 音频默认静音）
    this.mpegtsPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
      this.callbacks.onError?.(`${errType}: ${errDetail}`);
    });
    try {
      this.mpegtsPlayer.load();
      this.videoEl.play().catch(() => {
        this.callbacks.onError?.('浏览器阻止了自动播放，请再点一次播放');
      });
    } catch (err) {
      this.callbacks.onError?.(`启动播放失败: ${err.message}`);
      return false;
    }

    // 水位监测循环（任务 3.1）
    this.timerId = setInterval(() => this._tick(), TICK_INTERVAL_MS);
    return true;
  }

  // 设置调整即时生效，无需重建播放器
  applySettings(settings) {
    this.settings = settings;
  }

  _tick() {
    const video = this.videoEl;
    const wm = this._getWatermark();
    if (wm === null) return;
    this.callbacks.onWatermark?.(wm);

    const action = this._decide(wm);
    const buffered = video.buffered;

    if (action === ACTION.JUMP) {
      // 一跃到直播边缘：seek 到 buffered 末端（解码落在最新关键帧上）
      if (buffered.length > 0) {
        video.currentTime = buffered.end(buffered.length - 1);
      }
    } else if (action === ACTION.SPEED) {
      // 默认静音（用户只在乎画面），变速无音频包袱
      video.playbackRate = this.settings.speedRate;
    } else {
      video.playbackRate = 1;
    }

    if (action !== this.prevAction) {
      this.prevAction = action;
      this.callbacks.onAction?.(action, wm);
    }

    this._watchdog(video);
  }

  _getWatermark() {
    try {
      return getWatermarkMs(this.videoEl.buffered, this.videoEl.currentTime);
    } catch {
      return null;
    }
  }

  _decide(wm) {
    try {
      return decideAction(wm, this.settings, this.prevAction);
    } catch {
      return ACTION.NORMAL;
    }
  }

  // 任务 2.4：流中断有时不触发 ERROR（如 CDN 静默断开），
  // 用"缓冲末端不再增长"兜底判定，交给 UI 提示重贴地址
  _watchdog(video) {
    const buffered = video.buffered;
    const end = buffered.length > 0 ? buffered.end(buffered.length - 1) : null;
    const now = Date.now();
    if (end !== null && end !== this.lastBufferedEnd) {
      this.lastBufferedEnd = end;
      this.lastBufferedEndTime = now;
      return;
    }
    const starving = video.readyState < 3; // HAVE_FUTURE_DATA
    if (
      starving &&
      this.lastBufferedEnd !== null &&
      now - this.lastBufferedEndTime > STALL_TIMEOUT_MS
    ) {
      this.lastBufferedEndTime = now; // 只报一次，等 UI 介入
      this.callbacks.onStall?.(`缓冲 ${STALL_TIMEOUT_MS / 1000}s 未增长且已断流`);
    }
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.prevAction = ACTION.NORMAL;
    if (this.videoEl) {
      this.videoEl.playbackRate = 1;
    }
    if (this.mpegtsPlayer) {
      try {
        this.mpegtsPlayer.pause();
        this.mpegtsPlayer.unload();
        this.mpegtsPlayer.detachMediaElement();
        this.mpegtsPlayer.destroy();
      } catch {
        // 销毁失败不影响重新开始
      }
      this.mpegtsPlayer = null;
    }
  }

  dispose() {
    this.stop();
    this.videoEl.removeEventListener('error', this._boundVideoError);
  }
}
