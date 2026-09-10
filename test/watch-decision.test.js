import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WATCH_CONFIG,
  normalizeRoomInput,
  parseWatchArgs,
  computeBackoffMs,
  nextWatchState,
} from '../src/lib/watch-decision.js';

test('normalizeRoomInput: 纯房间号、完整链接、带查询参数的链接（spec: 两种指定方式）', () => {
  assert.deepEqual(normalizeRoomInput('134525032676'), { ok: true, room: '134525032676' });
  assert.deepEqual(normalizeRoomInput(' https://live.douyin.com/134525032676 '),
    { ok: true, room: '134525032676' });
  assert.deepEqual(normalizeRoomInput('https://live.douyin.com/999?from=web&ref=low'),
    { ok: true, room: '999' });
});

test('normalizeRoomInput: 无法识别的内容明确失败，不猜', () => {
  assert.equal(normalizeRoomInput('').ok, false);
  assert.equal(normalizeRoomInput('hello world').ok, false);
  assert.equal(normalizeRoomInput('https://v.douyin.com/abc/').ok, false); // 非数字路径
  assert.equal(normalizeRoomInput('https://example.com/123').ok, false); // 非抖音域名
  assert.equal(normalizeRoomInput(null).ok, false);
});

test('parseWatchArgs: provided 标记区分显式参数与默认值', () => {
  const bare = parseWatchArgs([]);
  assert.equal(bare.provided.room, false);
  const explicit = parseWatchArgs(['--room', 'https://live.douyin.com/999?x=1']);
  assert.equal(explicit.provided.room, true);
  assert.equal(explicit.config.room, '999');
});

test('parseWatchArgs: 无参数用默认（spec: 默认参数启动）', () => {
  const { config, warnings } = parseWatchArgs([]);
  assert.deepEqual(config, DEFAULT_WATCH_CONFIG);
  assert.deepEqual(warnings, []);
});

test('parseWatchArgs: 自定义 interval/room/origin（spec: 自定义轮询间隔）', () => {
  const { config, warnings } = parseWatchArgs([
    '--interval', '10',
    '--room', '999',
    '--origin', 'http://127.0.0.1:9999/',
  ]);
  assert.equal(config.intervalMs, 10000);
  assert.equal(config.room, '999');
  assert.equal(config.origin, 'http://127.0.0.1:9999'); // 尾部斜杠剥掉
  assert.deepEqual(warnings, []);
});

test('parseWatchArgs: 非法值回落默认并警告，不抛异常', () => {
  const { config, warnings } = parseWatchArgs([
    '--interval', '-5',
    '--room', 'abc',
    '--origin', 'ftp://x',
  ]);
  assert.equal(config.intervalMs, DEFAULT_WATCH_CONFIG.intervalMs);
  assert.equal(config.room, DEFAULT_WATCH_CONFIG.room);
  assert.equal(config.origin, DEFAULT_WATCH_CONFIG.origin);
  assert.equal(warnings.length, 3);
});

test('computeBackoffMs: interval 倍增，封顶 300s（spec: 递增退避不退出）', () => {
  assert.equal(computeBackoffMs(15000, 1), 30000);
  assert.equal(computeBackoffMs(15000, 2), 60000);
  assert.equal(computeBackoffMs(15000, 5), 300000); // 480s -> 封顶
  assert.equal(computeBackoffMs(300000, 1), 300000);
});

test('nextWatchState: 跳变沿矩阵（spec: 只在开播沿触发一次）', () => {
  // 冷启动即直播 -> 触发一次（刚启动就想看就开，design D3）
  assert.deepEqual(nextWatchState(null, 'live'), { trigger: true, state: 'live' });
  // 冷启动未开播 -> 静默
  assert.deepEqual(nextWatchState(null, 'offline'), { trigger: false, state: 'offline' });
  // 常规开播沿
  assert.deepEqual(nextWatchState('offline', 'live'), { trigger: true, state: 'live' });
  // 直播期间不再重复唤起
  assert.deepEqual(nextWatchState('live', 'live'), { trigger: false, state: 'live' });
  // 下播沿不触发，但记忆更新，下次开播能再触发
  assert.deepEqual(nextWatchState('live', 'offline'), { trigger: false, state: 'offline' });
  assert.deepEqual(nextWatchState('offline', 'offline'), { trigger: false, state: 'offline' });
});

test('nextWatchState: 失败（unknown）不改跳变沿记忆', () => {
  assert.deepEqual(nextWatchState('offline', 'unknown'), { trigger: false, state: 'offline' });
  // 失败几次后开播 -> 仍正确触发
  assert.deepEqual(nextWatchState(nextWatchState('offline', 'unknown').state, 'live'),
    { trigger: true, state: 'live' });
  // 直播中失败 -> 恢复后不重复唤起
  assert.deepEqual(nextWatchState(nextWatchState('live', 'unknown').state, 'live'),
    { trigger: false, state: 'live' });
  // 冷启动第一次就失败 -> 记忆保持 null，下次开播仍触发
  assert.deepEqual(nextWatchState(nextWatchState(null, 'unknown').state, 'live'),
    { trigger: true, state: 'live' });
});
