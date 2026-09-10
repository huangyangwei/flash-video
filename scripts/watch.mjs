#!/usr/bin/env node
// 开播轮询脚本（design D1）：轮询抖音房间页 -> 开播跳变沿提取 flv 地址 -> 深链唤起播放页。
// 用法：npm run watch [-- --interval 10 --room <id> --origin http://127.0.0.1:5173]
// 失败按递增退避重试（design D4），Ctrl+C 退出。手动粘贴流程始终保留为兜底。

import { exec } from 'node:child_process';
import readline from 'node:readline/promises';
import { parseRoomPage } from '../src/lib/room-page.js';
import {
  parseWatchArgs,
  normalizeRoomInput,
  computeBackoffMs,
  nextWatchState,
} from '../src/lib/watch-decision.js';

// 抖音对无 UA 请求直接拒绝；带浏览器 UA + Referer 的 GET 实测即返回全量页面
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function openInBrowser(link) {
  const quoted = `"${link}"`;
  const cmd =
    process.platform === 'win32'
      ? `start "" ${quoted}`
      : process.platform === 'darwin'
        ? `open ${quoted}`
        : `xdg-open ${quoted}`;
  exec(cmd, (err) => {
    if (err) console.error(`唤起浏览器失败（请手动打开）: ${link}\n${err.message}`);
  });
}

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

// 解析失败 reason -> 控制台可读文案（与 watch-engine 保持一致）
const FAIL_REASON_TEXT = {
  captcha: '触发风控验证码（轮询过频）。请在浏览器打开房间页过验证，期间保持退避',
};

// 房间未通过参数给定时交互询问（spec: 用户指定房间）；回车用默认，非法输入重问。
// 竞速 close 事件：Node 21 readline/promises 在 stdin EOF 时 pending 的
// question 永不 settle，会让顶层 await 挂死（exit 13），不能只等 promise。
function askOnce(rl, prompt) {
  return new Promise((resolve) => {
    rl.once('close', () => resolve(null)); // EOF -> null
    rl.question(prompt).then(resolve, () => resolve(null));
  });
}

async function askRoom(rl) {
  for (;;) {
    const answer = await askOnce(
      rl,
      `输入直播间链接或房间号（回车用默认 ${config.room}）: `
    );
    const text = (answer ?? '').trim();
    if (!text) return config.room; // 回车或 EOF 都用默认房间
    const normalized = normalizeRoomInput(text);
    if (normalized.ok) return normalized.room;
    console.warn(
      `[warn] 无法识别 "${text}"，请输入数字房间号或形如 https://live.douyin.com/<房间号> 的链接`
    );
  }
}

const { config, warnings, provided } = parseWatchArgs(process.argv.slice(2));
// 可选浏览器 Cookie（被风控时填，与页面监测同一用途）
const cookieIdx = process.argv.indexOf('--cookie');
const cookie = cookieIdx !== -1 ? process.argv[cookieIdx + 1] : undefined;
for (const w of warnings) console.warn(`[warn] ${w}`);
if (!provided.room) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    config.room = await askRoom(rl); // stdin 关闭（EOF）时视为回车，保留默认
  } finally {
    rl.close();
  }
}
console.log(
  `watch: 房间 ${config.room} · 间隔 ${config.intervalMs / 1000}s · 播放页 ${config.origin} · Ctrl+C 退出`
);

let state = null; // null=冷启动 | 'live' | 'offline'（跳变沿记忆）
let failCount = 0;
let timer = null;

function schedule(delayMs) {
  timer = setTimeout(poll, delayMs);
}

async function poll() {
  try {
    const headers = {
      'User-Agent': USER_AGENT,
      Referer: `https://live.douyin.com/${config.room}`,
    };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`https://live.douyin.com/${config.room}`, {
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseRoomPage(await res.text());
    if (!parsed.ok) {
      throw new Error(FAIL_REASON_TEXT[parsed.reason] ?? `解析失败: ${parsed.reason}`);
    }

    failCount = 0;
    const transition = nextWatchState(state, parsed.live ? 'live' : 'offline');
    state = transition.state;

    if (transition.trigger && parsed.live) {
      // hash 传参而非查询串：vite dev 安全补丁对含编码 URL 的查询串 403
      const link = `${config.origin}/#/?url=${encodeURIComponent(parsed.bestUrl)}`;
      console.log(`[${timestamp()}] 开播! ${parsed.bestUrl}`);
      console.log(`[${timestamp()}] 唤起播放页: ${link}`);
      openInBrowser(link);
    } else if (parsed.live) {
      console.log(`[${timestamp()}] 直播中（本轮已唤起过，持续观看中）`);
    } else {
      console.log(`[${timestamp()}] 未开播`);
    }
    schedule(config.intervalMs);
  } catch (err) {
    failCount += 1;
    const waitMs = computeBackoffMs(config.intervalMs, failCount);
    console.error(
      `[${timestamp()}] 轮询失败（连续 ${failCount} 次）: ${err.message} -> ${waitMs / 1000}s 后重试`
    );
    schedule(waitMs);
  }
}

process.on('SIGINT', () => {
  clearTimeout(timer);
  process.exit(0);
});

poll();
