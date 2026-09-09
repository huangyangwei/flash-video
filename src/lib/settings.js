// 追帧设置模型（纯逻辑，无 DOM，便于 node 测试）

export const DEFAULT_SETTINGS = {
  catchupEnabled: true,
  speedThresholdMs: 1000,
  speedRate: 1.1,
  // null 表示禁用跳帧
  jumpThresholdMs: 2000,
};

export const MIN_RATE = 1.05;
// 音频默认静音，上限只受画面可感知快放约束（design D3）
export const MAX_RATE = 2.0;

export const STORAGE_KEY = 'flash-video:settings';

// 把任意输入约束为合法设置；unknown 字段丢弃，非法值回落默认值
export function sanitizeSettings(input) {
  const s = { ...DEFAULT_SETTINGS };
  if (!input || typeof input !== 'object') return s;

  if (typeof input.catchupEnabled === 'boolean') {
    s.catchupEnabled = input.catchupEnabled;
  }
  const rate = Number(input.speedRate);
  if (Number.isFinite(rate)) {
    // 超出范围的倍率约束到边界，而不是拒绝
    s.speedRate = Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
  }
  const st = Number(input.speedThresholdMs);
  if (Number.isFinite(st) && st >= 0) {
    s.speedThresholdMs = st;
  }
  if (input.jumpThresholdMs === null || input.jumpThresholdMs === undefined) {
    s.jumpThresholdMs = null; // 用户显式禁用
  } else {
    const jt = Number(input.jumpThresholdMs);
    if (Number.isFinite(jt) && jt > 0) {
      s.jumpThresholdMs = jt;
    }
  }
  return s;
}

export function loadSettings() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { ...DEFAULT_SETTINGS }; // 隐私模式等 localStorage 不可用
  }
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 存不上就算了，设置只在本次会话生效
  }
}
