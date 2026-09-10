// 开播监测引擎（纯逻辑胶水，IO 全部注入）：轮询循环 + 跳变沿 + 失败退避。
// 复用 room-page（解析）与 watch-decision（跳变沿/退避/房间归一化）。
// 页面监测（vite 插件）与 CLI watch 脚本共用本引擎。

import { parseRoomPage } from './room-page.js';
import {
  normalizeRoomInput,
  computeBackoffMs,
  nextWatchState,
} from './watch-decision.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 10000;

// 解析失败 reason -> 页面可读文案
const FAIL_REASON_TEXT = {
  captcha: '触发风控验证码（轮询过频）。请在浏览器打开房间页过验证，期间保持退避',
};

/**
 * @param {object} deps 注入项（测试用假实现）
 * @param {typeof fetch} deps.fetchImpl
 * @param {(ms:number)=>Promise} deps.sleepImpl
 * @param {number} deps.hardCapMs 单轮轮询硬超时（防 undici 挂死，默认 20s）
 */
export function createWatchEngine({
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
  hardCapMs = 20000,
} = {}) {
  // status 即对外快照：enabled/room/intervalMs/live/flvUrl/lastError/lastCheckAt/failCount
  const status = {
    enabled: false,
    room: null,
    intervalMs: null,
    cookie: null, // 可选：浏览器 Cookie（被风控时填入，含 ttwid 即可）
    live: false,
    flvUrl: null,
    lastError: null,
    lastCheckAt: null,
    failCount: 0,
  };
  let loopToken = 0; // 代次标记：stop/重启使旧循环失效
  let prevState = null; // 跳变沿记忆（null=冷启动）

  // 单轮硬超时：fetch 的 AbortSignal 在 Node 21 undici 偶发失效
  // （连接半关闭时 body 读取永久挂起），这层保证循环永远卡不过 20s
  function withHardCap(task) {
    return Promise.race([
      task(),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error(`单轮轮询硬超时(${hardCapMs / 1000}s)`)), hardCapMs);
        t.unref?.(); // 不阻止进程退出
      }),
    ]);
  }

  async function runLoop(token) {
    while (token === loopToken && status.enabled) {
      let failed = null;
      try {
        await withHardCap(async () => {
          const headers = {
            'User-Agent': USER_AGENT,
            Referer: `https://live.douyin.com/${status.room}`,
          };
          if (status.cookie) headers.Cookie = status.cookie; // 带浏览器身份过风控
          const res = await fetchImpl(`https://live.douyin.com/${status.room}`, {
            headers,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const parsed = parseRoomPage(await res.text());
          if (!parsed.ok) {
            throw new Error(FAIL_REASON_TEXT[parsed.reason] ?? `解析失败: ${parsed.reason}`);
          }
          status.failCount = 0;
          status.lastError = null;
          const transition = nextWatchState(prevState, parsed.live ? 'live' : 'offline');
          prevState = transition.state;
          status.live = parsed.live;
          status.flvUrl = parsed.live ? parsed.bestUrl : null;
        });
      } catch (err) {
        // 失败不改跳变沿记忆与上次开播状态，只记错误走退避
        failed = err.message ?? String(err);
        status.failCount += 1;
        status.lastError = failed;
        const t = nextWatchState(prevState, 'unknown');
        prevState = t.state;
      }
      status.lastCheckAt = Date.now();
      const waitMs =
        failed !== null
          ? computeBackoffMs(status.intervalMs, status.failCount) // 封顶 300s
          : status.intervalMs;
      await sleepImpl(waitMs);
    }
  }

  return {
    /** 启动监测。房间非法返回 {ok:false}。重复调用会更新配置并重置退避
     *  （用户改完 cookie/间隔点"开始"应立即以新配置重试，而不是等旧退避）。 */
    start({ room, intervalMs, cookie } = {}) {
      const normalized = normalizeRoomInput(room);
      if (!normalized.ok) return { ok: false, reason: normalized.reason };
      status.room = normalized.room;
      status.intervalMs = intervalMs;
      status.cookie = cookie || null;
      if (status.enabled) {
        status.failCount = 0; // 重置退避，下一轮立即以新配置执行
        return { ok: true, updated: true };
      }
      status.enabled = true;
      status.failCount = 0;
      status.lastError = null;
      status.live = false;
      status.flvUrl = null;
      prevState = null; // 冷启动：已在直播则首轮即触发
      runLoop(++loopToken);
      return { ok: true };
    },

    /** 停止并清空监测结果（保留 cookie，方便过验证后直接重启）。 */
    stop() {
      status.enabled = false;
      status.live = false;
      status.flvUrl = null;
      status.lastError = null;
      status.failCount = 0;
      ++loopToken;
    },

    /** 运行中改配置（房间/间隔/cookie），自下一轮生效。 */
    setConfig({ room, intervalMs, cookie } = {}) {
      if (room !== undefined) {
        const normalized = normalizeRoomInput(room);
        if (!normalized.ok) return { ok: false, reason: normalized.reason };
        status.room = normalized.room;
      }
      if (intervalMs !== undefined) status.intervalMs = intervalMs;
      if (cookie !== undefined) status.cookie = cookie || null;
      return { ok: true };
    },

    getStatus() {
      return { ...status };
    },
  };
}
