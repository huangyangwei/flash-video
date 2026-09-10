// watch 轮询决策（纯逻辑，无 IO）：参数解析、失败退避、开播跳变沿判定。
// 跳变沿规则（design D3）：只在 未开播/未知 -> 直播中 时触发一次；
// 轮询失败（unknown）不改变跳变沿记忆，恢复后能正确接上。

export const DEFAULT_WATCH_CONFIG = {
  room: '134525032676',
  intervalMs: 15000, // 正常轮询间隔（用户明确要求可自定义）
  origin: 'http://127.0.0.1:5173',
  timeoutMs: 10000,
};
const BACKOFF_CAP_MS = 300000; // 退避上限 5min

// 房间输入归一化：接受纯房间号（数字）或完整直播间链接
// （https://live.douyin.com/<id>?from=xxx 等），提取路径中的数字房间号。
// 返回 {ok:true, room} 或 {ok:false, reason}。
export function normalizeRoomInput(input) {
  const text = (input ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (/^\d+$/.test(text)) return { ok: true, room: text };
  try {
    const u = new URL(text);
    if (/(\.|^)douyin\.com$/.test(u.hostname)) {
      const m = u.pathname.match(/^\/(\d+)\/?$/);
      if (m) return { ok: true, room: m[1] };
    }
  } catch {
    // 不是合法 URL，按无法识别处理
  }
  return { ok: false, reason: 'unrecognized' };
}

// argv 形如 ['--interval', '10']；interval 单位秒。非法值回落默认并带警告。
// 返回额外带 provided 标记（交互询问逻辑需要知道用户是否显式给了 --room）。
export function parseWatchArgs(argv, defaults = DEFAULT_WATCH_CONFIG) {
  const config = { ...defaults };
  const provided = { room: false, interval: false, origin: false };
  const warnings = [];
  const take = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const room = take('--room');
  if (room !== undefined) {
    const normalized = normalizeRoomInput(room);
    if (normalized.ok) {
      config.room = normalized.room;
      provided.room = true;
    } else {
      warnings.push(`--room 无法识别（${room}），使用默认 ${config.room}`);
    }
  }
  const interval = take('--interval');
  if (interval !== undefined) {
    provided.interval = true;
    const sec = Number(interval);
    if (Number.isFinite(sec) && sec > 0) {
      config.intervalMs = Math.round(sec * 1000);
    } else {
      warnings.push(`--interval 非法（${interval}），使用默认 ${config.intervalMs / 1000}s`);
    }
  }
  const origin = take('--origin');
  if (origin !== undefined) {
    provided.origin = true;
    if (/^https?:\/\//.test(origin)) {
      config.origin = origin.replace(/\/+$/, '');
    } else {
      warnings.push(`--origin 非法（${origin}），使用默认 ${config.origin}`);
    }
  }
  return { config, warnings, provided };
}

// 失败退避：interval × 2^连续失败次数，封顶 300s；成功后 failCount 清零由调用方负责
export function computeBackoffMs(intervalMs, failCount) {
  return Math.min(intervalMs * 2 ** Math.max(failCount, 0), BACKOFF_CAP_MS);
}

/**
 * 跳变沿判定。prev: null（冷启动）| 'live' | 'offline'；current: 'live' | 'offline' | 'unknown'
 * 返回 { trigger: 是否唤起, state: 新状态 }
 */
export function nextWatchState(prev, current) {
  if (current === 'unknown') {
    // 失败不改记忆：保持 prev，恢复后跳变沿仍然成立
    return { trigger: false, state: prev };
  }
  const trigger = current === 'live' && prev !== 'live';
  return { trigger, state: current };
}
