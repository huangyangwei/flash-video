// UI 装配：把设置面板、播放器、追帧引擎、断流提示接到 DOM 上
import { LowLatencyPlayer, isFlvUrl } from './player.js';
import {
  DEFAULT_SETTINGS,
  MIN_RATE,
  MAX_RATE,
  sanitizeSettings,
  loadSettings,
  saveSettings,
} from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const videoEl = $('video');
const urlInput = $('url-input');
const playBtn = $('play-btn');
const playerPanel = $('player-panel');
const statusLine = $('status-line');
const errorDialog = $('error-dialog');
const errorMessage = $('error-message');
const retryUrlInput = $('retry-url-input');
const rateHint = $('rate-hint');

const settingsInputs = {
  catchupEnabled: $('catchup-enabled'),
  speedThresholdMs: $('speed-threshold'),
  speedRate: $('speed-rate'),
  jumpThresholdMs: $('jump-threshold'),
};
const jumpEnabledInput = $('jump-enabled');

let settings = loadSettings();
let player = null;
let lastUrl = null;
let currentActionLabel = '正常播放';
const ACTION_LABELS = { normal: '正常播放', speed: '变速追帧', jump: '跳帧' };
const RETRY_TOTAL = 3; // 初始连接自动重试次数（spec: 递增退避共 3 次）

function currentUrl() {
  return (urlInput.value || retryUrlInput.value || '').trim();
}

function readSettingsFromUi() {
  const raw = {
    catchupEnabled: settingsInputs.catchupEnabled.checked,
    speedThresholdMs: Number(settingsInputs.speedThresholdMs.value),
    speedRate: Number(settingsInputs.speedRate.value),
    // 跳帧禁用 -> null（sanitizeSettings 会保留 null）
    jumpThresholdMs: jumpEnabledInput.checked
      ? Number(settingsInputs.jumpThresholdMs.value)
      : null,
  };
  settings = sanitizeSettings(raw);
  syncSettingsToUi();
  saveSettings(settings);
  player?.applySettings(settings);
}

// 把 sanitize 后的值写回控件（越界倍率被约束时用户能看到实际生效值）
function syncSettingsToUi() {
  settingsInputs.catchupEnabled.checked = settings.catchupEnabled;
  settingsInputs.speedThresholdMs.value = settings.speedThresholdMs;
  settingsInputs.speedRate.value = settings.speedRate;
  settingsInputs.jumpThresholdMs.value = settings.jumpThresholdMs ?? DEFAULT_SETTINGS.jumpThresholdMs;
  jumpEnabledInput.checked = settings.jumpThresholdMs !== null;
  rateHint.textContent = `倍率硬限制在 ${MIN_RATE}~${MAX_RATE}x（音频已静音）；想更快追上请降低跳帧阈值`;
  for (const input of Object.values(settingsInputs)) {
    input.disabled = !settings.catchupEnabled;
  }
  settingsInputs.jumpThresholdMs.disabled =
    !settings.catchupEnabled || !jumpEnabledInput.checked;
}

function showWatermark(wm) {
  statusLine.textContent = `水位 ${Math.round(wm)} ms · 状态 ${currentActionLabel}`;
}

function startPlayback(url) {
  if (!isFlvUrl(url)) {
    showError(`地址格式不像 .flv 拉流地址：${url || '(空)'}`);
    return;
  }
  if (!player) {
    player = new LowLatencyPlayer(videoEl, {
      onWatermark: showWatermark,
      onAction: (action) => {
        currentActionLabel = ACTION_LABELS[action] ?? action;
      },
      onError: showError,
      onStall: showError,
      // 初始连接失败自动重试（design D5）：UI 展示重试进度，不弹错误框
      onRetry: (attempt, delayMs) => {
        currentActionLabel = `重试中 ${attempt}/${RETRY_TOTAL}`;
        statusLine.textContent = `连接失败，${Math.round(delayMs / 1000)}s 后第 ${attempt}/${RETRY_TOTAL} 次重试…`;
      },
    });
  }
  if (player.start(url, settings)) {
    lastUrl = url;
    playerPanel.hidden = false;
    errorDialog.close?.();
  }
}

function showError(message) {
  errorMessage.textContent = message;
  retryUrlInput.value = lastUrl ?? urlInput.value;
  if (typeof errorDialog.showModal === 'function') {
    errorDialog.showModal();
  }
}

playBtn.addEventListener('click', () => startPlayback(currentUrl()));
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startPlayback(currentUrl());
});
$('retry-btn').addEventListener('click', () => {
  const url = retryUrlInput.value.trim();
  startPlayback(url); // 新实例天然从直播边缘开始（design D5）
});
$('dismiss-btn').addEventListener('click', () => errorDialog.close());

for (const input of [...Object.values(settingsInputs), jumpEnabledInput]) {
  input.addEventListener('change', readSettingsFromUi);
}

syncSettingsToUi();

// 深链自动开播（spec: 深链参数自动开播）：watch 脚本唤起时带 #/?url= 参数，
// 走与手动粘贴完全相同的校验与开播路径；地址回填输入框让用户可见来源。
// 参数缺失 = 现状不变。注意用 hash 而非查询串传参：vite dev 的安全补丁
// 会对含编码绝对 URL 的查询串做 fs 校验直接 403，hash 不经过服务器。
const hashPart = location.hash.replace(/^#\/?/, ''); // '#/?url=x' -> '?url=x'
const hashQuery = hashPart.startsWith('?') ? hashPart.slice(1) : hashPart;
const deepLinkUrl = new URLSearchParams(hashQuery).get('url')?.trim();
if (deepLinkUrl) {
  urlInput.value = deepLinkUrl;
  startPlayback(deepLinkUrl);
}

// ---- 开播监测（spec: 播放页配置监测）----
// 轮询跑在 dev server 侧（/__watch/api，vite 插件），页面只做配置与结果消费。
const watchRoom = $('watch-room');
const watchInterval = $('watch-interval');
const watchCookie = $('watch-cookie');
const watchToggle = $('watch-toggle');
const watchStatus = $('watch-status');
const WATCH_API = '/__watch/api';
const WATCH_STATUS_POLL_MS = 2000;
let autoStartedUrl = null; // 同一场直播只自动开播一次
let watchEnabled = false; // 最近一次状态轮询的引擎开关

watchRoom.value = localStorage.getItem('watchRoom') ?? '';
watchInterval.value = localStorage.getItem('watchInterval') ?? 15;
watchCookie.value = localStorage.getItem('watchCookie') ?? '';

function renderWatchStatus(s) {
  watchEnabled = s.enabled;
  watchToggle.textContent = s.enabled ? '停止监测' : '开始监测';
  if (!s.enabled) {
    watchStatus.textContent = '未监测';
    return;
  }
  const checked = s.lastCheckAt ? new Date(s.lastCheckAt).toLocaleTimeString('zh-CN', { hour12: false }) : '--';
  const state = s.lastError
    ? `失败(${s.failCount}次): ${s.lastError} · 退避中`
    : s.live
      ? `直播中 · 已自动开播`
      : '未开播';
  const cookieTag = s.cookie ? ' · 已带 Cookie' : '';
  watchStatus.textContent = `监测房间 ${s.room} · 间隔 ${s.intervalMs / 1000}s${cookieTag} · ${state} · 上次检查 ${checked}`;
}

async function watchApi(action, payload = {}) {
  const res = await fetch(WATCH_API, {
    method: action === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: action === undefined ? undefined : JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

watchToggle.addEventListener('click', async () => {
  const room = watchRoom.value.trim() || '134525032676'; // 留空 = 默认房间
  const sec = Number(watchInterval.value) || 15;
  const cookie = watchCookie.value.trim(); // 选填：被风控时填浏览器 Cookie
  const action = watchEnabled ? 'stop' : 'start';
  localStorage.setItem('watchRoom', watchRoom.value);
  localStorage.setItem('watchInterval', String(sec));
  localStorage.setItem('watchCookie', watchCookie.value);
  const result = await watchApi(
    action,
    action === 'start' ? { room, intervalSec: sec, cookie } : {}
  );
  if (result.ok === false) {
    watchStatus.textContent = `操作失败: ${result.error}`;
  }
  renderWatchStatus(result);
});

// 状态轮询 + 开播消费：监测到直播中且是新的一场 -> 自动开播
setInterval(async () => {
  try {
    const s = await watchApi();
    renderWatchStatus(s);
    if (s.enabled && s.live && s.flvUrl && s.flvUrl !== autoStartedUrl) {
      autoStartedUrl = s.flvUrl;
      urlInput.value = s.flvUrl; // 回填让用户可见来源
      startPlayback(s.flvUrl);
    }
  } catch {
    // dev server 未挂插件（如生产构建）时静默，面板保持原样
    watchStatus.textContent = '监测服务不可用（需要 npm run dev 运行）';
  }
}, WATCH_STATUS_POLL_MS);
