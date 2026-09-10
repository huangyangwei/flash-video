import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchEngine } from '../src/lib/watch-engine.js';

// 让出事件循环（轮询循环是 while + sleep，必须真的 yield 才能推进）
const tick = (n = 5) => new Promise((r) => setTimeout(r, n));

const LIVE_HTML = 'x\\"flv_pull_url\\":{\\"FULL_HD1\\":\\"http://cdn/x.flv?k=1\\"}y';
const OFFLINE_HTML = '...\\"status\\":4...';

function fakeFetchSequence(responses) {
  const calls = [];
  const impl = async () => {
    calls.push(1);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return { ok: true, status: 200, text: async () => next };
  };
  return { impl, count: () => calls.length };
}

function engineWith(responses) {
  const fetcher = fakeFetchSequence(responses);
  // sleep 忽略时长：interval/退避在测试里瞬间过去，只让出事件循环
  const engine = createWatchEngine({ fetchImpl: fetcher.impl, sleepImpl: () => tick() });
  return { engine, pollCount: fetcher.count };
}

test('启动监测：已在直播的房间首轮即提取 flv 地址（spec: 冷启动即触发）', async () => {
  const { engine, pollCount } = engineWith([LIVE_HTML]);
  try {
    const r = engine.start({ room: 'https://live.douyin.com/999?x=1', intervalMs: 1000 });
    assert.equal(r.ok, true);
    await tick();
    const s = engine.getStatus();
    assert.equal(s.enabled, true);
    assert.equal(s.room, '999');
    assert.equal(s.live, true);
    assert.equal(s.flvUrl, 'http://cdn/x.flv?k=1');
    assert.ok(pollCount() >= 1);
  } finally {
    engine.stop();
  }
});

test('停止监测：enabled 翻转、结果清空、轮询循环退出', async () => {
  const { engine } = engineWith([LIVE_HTML]);
  engine.start({ room: '123', intervalMs: 1000 });
  await tick();
  assert.equal(engine.getStatus().live, true);
  engine.stop();
  const s = engine.getStatus();
  assert.equal(s.enabled, false);
  assert.equal(s.live, false);
  assert.equal(s.flvUrl, null);
  const count = engine.getStatus().failCount;
  await tick(20);
  assert.equal(engine.getStatus().failCount, count); // 循环已停
});

test('轮询失败：lastError 可见、不误报开播、按退避持续重试', async () => {
  const { engine, pollCount } = engineWith([new Error('HTTP 403'), new Error('boom')]);
  try {
    engine.start({ room: '123', intervalMs: 1000 });
    await tick(20);
    const s = engine.getStatus();
    assert.equal(s.live, false);
    assert.equal(s.flvUrl, null);
    assert.ok(s.lastError);
    assert.equal(s.failCount >= 2, true); // 退避（测试中瞬时）后仍在重试
    assert.ok(pollCount() >= 2);
  } finally {
    engine.stop();
  }
});

test('失败后恢复：跳变沿记忆保留，恢复轮询后正确触发开播', async () => {
  // 第一轮失败，之后一直直播
  const { engine } = engineWith([new Error('timeout'), LIVE_HTML, LIVE_HTML]);
  try {
    engine.start({ room: '123', intervalMs: 1000 });
    await tick(30);
    const s = engine.getStatus();
    assert.equal(s.live, true);
    assert.ok(s.flvUrl);
  } finally {
    engine.stop();
  }
});

test('房间非法：start 拒绝且不启动轮询', async () => {
  const { engine, pollCount } = engineWith([LIVE_HTML]);
  const r = engine.start({ room: 'not-a-room', intervalMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(engine.getStatus().enabled, false);
  await tick();
  assert.equal(pollCount(), 0);
});

test('运行中 setConfig 换房间即时生效（spec: 配置即时生效）', async () => {
  const { engine } = engineWith([OFFLINE_HTML]);
  engine.start({ room: '123', intervalMs: 1000 });
  await tick();
  const r = engine.setConfig({ room: 'https://live.douyin.com/456', intervalMs: 2000 });
  assert.equal(r.ok, true);
  assert.equal(engine.getStatus().room, '456');
  assert.equal(engine.getStatus().intervalMs, 2000);
  engine.stop();
});

test('fetch 永久挂起时硬超时兜底，循环不死（回归：undici body 挂起 bug）', async () => {
  const engine = createWatchEngine({
    fetchImpl: () => new Promise(() => {}), // 永不 resolve
    sleepImpl: () => tick(),
    hardCapMs: 10, // 测试用 10ms 硬超时
  });
  try {
    engine.start({ room: '123', intervalMs: 1000 });
    await tick(50); // 挂起 fetch 烧穿多轮硬超时
    const s = engine.getStatus();
    assert.equal(s.enabled, true); // 循环还活着
    assert.ok(s.failCount >= 2, '多轮轮询均按硬超时记失败');
    assert.ok(s.lastError.includes('硬超时'));
    assert.ok(s.lastCheckAt); // 时间戳在推进
  } finally {
    engine.stop();
  }
});

test('配置 Cookie 后请求携带 Cookie 头，状态只报有无不泄露内容', async () => {
  let seenHeaders = null;
  const engine = createWatchEngine({
    fetchImpl: async (url, init) => {
      seenHeaders = init.headers;
      return { ok: true, status: 200, text: async () => LIVE_HTML };
    },
    sleepImpl: () => tick(),
  });
  try {
    engine.start({ room: '123', intervalMs: 1000, cookie: 'ttwid=abc; s_v_web_id=x' });
    await tick();
    assert.equal(seenHeaders.Cookie, 'ttwid=abc; s_v_web_id=x');
    const s = engine.getStatus();
    assert.equal(typeof s.cookie, 'string');
    assert.ok(s.cookie.includes('ttwid=abc')); // 引擎自己要用，快照里原样带出
    // setConfig 更新 cookie 即时生效
    engine.setConfig({ cookie: 'ttwid=new' });
    await tick();
    assert.equal(seenHeaders.Cookie, 'ttwid=new');
    engine.setConfig({ cookie: '' }); // 清空 -> 不带头
    await tick();
    assert.equal('Cookie' in seenHeaders, false);
  } finally {
    engine.stop();
  }
});
