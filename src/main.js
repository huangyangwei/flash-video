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
