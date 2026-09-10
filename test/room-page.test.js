import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoomPage } from '../src/lib/room-page.js';

// 夹具按 2026-09-09 真实抓包格式构造：转义 JSON（\" 与 &）
const LIVE_SNIPPET = [
  'self.__pace_f.push([...."room_id_str\\":\\"7683\\",\\"status\\":2,',
  '\\"stream_url\\":{\\"flv_pull_url\\":{\\"FULL_HD1\\":\\"http://pull-t5.douyincdn.com/x_uhd.flv?expire=1789559670\\u0026sign=f912\\",',
  '\\"HD1\\":\\"http://pull-t5.douyincdn.com/x_hd.flv?expire=1\\u0026sign=a\\"}}....]);',
].join('\n');

test('直播中样本：提取状态与 flv 地址，优先 FULL_HD1', () => {
  const r = parseRoomPage(LIVE_SNIPPET);
  assert.equal(r.ok, true);
  assert.equal(r.live, true);
  assert.match(r.bestUrl, /^http:\/\/pull-t5\.douyincdn\.com\/x_uhd\.flv\?/);
  // & 解码
  assert.ok(r.bestUrl.includes('&sign=f912'));
  assert.equal(Object.keys(r.flvUrls).length, 2);
});

test('无 FULL_HD1 时退回第一个可用地址', () => {
  const html =
    'x\\"flv_pull_url\\":{\\"SD1\\":\\"http://cdn/x_sd.flv?k=1\\"}y';
  const r = parseRoomPage(html);
  assert.equal(r.live, true);
  assert.equal(r.bestUrl, 'http://cdn/x_sd.flv?k=1');
});

test('页面出现 flv 地址即判开播，不受杂散 status 干扰', () => {
  // 某个无关模块的 status:4 出现在流数据之后，也应以地址为准
  const html = LIVE_SNIPPET + ',"other_status\\":4';
  assert.equal(parseRoomPage(html).live, true);
});

test('明确"已结束"枚举且无流地址 -> 未开播（ok 但 live:false）', () => {
  const html = '..."status\\":4,\\"room_id_str\\":\\"1\\"...';
  const r = parseRoomPage(html);
  assert.equal(r.ok, true);
  assert.equal(r.live, false);
});

test('空页面/无字段 -> 解析失败，不误报开播（宁可漏报）', () => {
  assert.deepEqual(parseRoomPage(''), { ok: false, reason: 'empty' });
  const r = parseRoomPage('<html><body>verify page</body></html>');
  assert.equal(r.ok, false);
  assert.equal('live' in r, false);
});

test('风控验证码中间页 -> 归类为 captcha（spike 5.2 实测样本格式）', () => {
  const captchaHtml = '<html><head><title>验证码中间页</title></head><body>captcha verify</body></html>';
  const r = parseRoomPage(captchaHtml);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'captcha');
  // 验证码页里的杂散字段不构成开播误报
  assert.equal('live' in r, false);
});

test('null/非字符串输入 -> 解析失败不抛异常', () => {
  assert.equal(parseRoomPage(null).ok, false);
  assert.equal(parseRoomPage(undefined).ok, false);
  assert.equal(parseRoomPage(123).ok, false);
});
