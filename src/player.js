// mpegts.js 播放器封装：最小缓冲配置 + 追帧循环 + 断流看门狗 + 初始连接自动重试
import mpegts from 'mpegts.js';
import { decideAction, getWatermarkMs, ACTION } from './lib/catchup.js';
import { retryPlan } from './lib/connect-retry.js';

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
  constructor(videoEl, { onWatermark, onAction, onError, onStall, onRetry } = {}) {
    this.videoEl = videoEl;
    this.mpegtsPlayer = null;
    this.settings = null;
    this.prevAction = ACTION.NORMAL;
    this.timerId = null;
    this.retryTimerId = null;
    // 初始连接重试状态（design D5）：收到过媒体数据即退出重试资格
    this.connectFailCount = 0;
    this.hasReceivedMedia = false;
    // 看门狗状态：上一次观察到的缓冲末端时间戳
    this.lastBufferedEnd = null;
    this.lastBufferedEndTime = Date.now();
    this.callbacks = { onWatermark, onAction, onError, onStall, onRetry };
    this._boundVideoError = (e) =>
      this.callbacks.onError?.(`视频元素错误: ${e.message || 'unknown'}`);
    videoEl.addEventListener('error', this._boundVideoError);
  }

  start(url, settings) {
    this.stop();
    this.settings = settings;
    this.lastBufferedEnd = null;
    this.lastBufferedEndTime = Date.now();
    this.connectFailCount = 0;
    this.hasReceivedMedia = false;

    if (!mpegts.getFeatureList().mseLivePlayback) {
      this.callbacks.onError?.('当前浏览器不支持 MSE 直播播放');
      return false;
    }

    // 水位监测循环（任务 3.1）：先起循环再建连接，重试期间水位循环保持运转
    this.timerId = setInterval(() => this._tick(), TICK_INTERVAL_MS);
    this._createAndLoad(url);
    return true;
  }

  // 建立一次 mpegts 连接；初始连接失败时由 _onPlayerError 决定重试
  _createAndLoad(url) {
    this.mpegtsPlayer = mpegts.createPlayer(
      { type: 'flv', isLive: true, url },
      PLAYER_CONFIG
    );
    this.mpegtsPlayer.attachMediaElement(this.videoEl);
    this.videoEl.muted = true; // 音频默认静音（spec: 音频默认静音）
    this.mpegtsPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
      this._onPlayerError(errType, errDetail, url);
    });
    try {
      this.mpegtsPlayer.load();
      this.videoEl.play().catch(() => {
        this.callbacks.onError?.('浏览器阻止了自动播放，请再点一次播放');
      });
    } catch (err) {
      this.callbacks.onError?.(`启动播放失败: ${err.message}`);
    }
  }

  // 初始连接失败（未收到过媒体 + 网络类错误）时按 2s/4s/8s 自动重试 3 次；
  // 其余错误交给 UI（中段断流由看门狗兜底判定，重试无意义——地址多半已过期）
  _onPlayerError(errType, errDetail, url) {
    const plan = retryPlan({
      failedAttempts: this.connectFailCount + 1,
      hasMedia: this.hasReceivedMedia,
      isNetworkError: errType === 'NetworkError',
    });
    if (!plan.retry) {
      this.callbacks.onError?.(`${errType}: ${errDetail}`);
      return;
    }
    this.connectFailCount = plan.attempt;
    this._teardownMpegts();
    this.callbacks.onRetry?.(plan.attempt, plan.delayMs, errDetail);
    this.retryTimerId = setTimeout(() => {
      this.retryTimerId = null;
      this._createAndLoad(url);
    }, plan.delayMs);
  }

  // 设置调整即时生效，无需重建播放器
  applySettings(settings) {
    this.settings = settings;
  }

  _tick() {
    const video = this.videoEl;
    const wm = this._getWatermark();
    if (wm === null) return;
    // 收到首个水位 = 媒体数据已到达，初始连接阶段结束（退出重试资格）
    if (!this.hasReceivedMedia) {
      this.hasReceivedMedia = true;
      this.connectFailCount = 0;
    }
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

  // 仅销毁 mpegts 实例（重试路径复用：保留重试状态与监测循环）
  _teardownMpegts() {
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

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.retryTimerId) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
    this.prevAction = ACTION.NORMAL;
    this.connectFailCount = 0;
    this.hasReceivedMedia = false;
    if (this.videoEl) {
      this.videoEl.playbackRate = 1;
    }
    this._teardownMpegts();
  }

  dispose() {
    this.stop();
    this.videoEl.removeEventListener('error', this._boundVideoError);
  }
}
