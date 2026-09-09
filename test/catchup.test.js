import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAction, getWatermarkMs, ACTION } from '../src/lib/catchup.js';

const SETTINGS = {
  catchupEnabled: true,
  speedThresholdMs: 1000,
  speedRate: 1.1,
  jumpThresholdMs: 2000,
};

test('水位低 -> 正常播放', () => {
  assert.equal(decideAction(500, SETTINGS, ACTION.NORMAL), ACTION.NORMAL);
});

test('水位超过变速阈值 -> 变速（spec: 变速追帧路径）', () => {
  assert.equal(decideAction(1100, SETTINGS, ACTION.NORMAL), ACTION.SPEED);
});

test('变速有迟滞：回落到阈值一半以上保持变速', () => {
  assert.equal(decideAction(600, SETTINGS, ACTION.SPEED), ACTION.SPEED);
  assert.equal(decideAction(499, SETTINGS, ACTION.SPEED), ACTION.NORMAL);
});

test('水位超过跳帧阈值 -> 跳帧优先于变速', () => {
  assert.equal(decideAction(2100, SETTINGS, ACTION.SPEED), ACTION.JUMP);
});

test('跳帧禁用后永不跳帧，超限水位走变速（spec: 超限跳帧可禁用）', () => {
  const s = { ...SETTINGS, jumpThresholdMs: null };
  assert.equal(decideAction(99999, s, ACTION.NORMAL), ACTION.SPEED);
});

test('总开关关闭 -> 一切退化为正常播放（spec: 关闭追帧）', () => {
  const s = { ...SETTINGS, catchupEnabled: false };
  assert.equal(decideAction(99999, s, ACTION.SPEED), ACTION.NORMAL);
});

test('getWatermarkMs: buffered 末端与 currentTime 差值', () => {
  const ranges = { length: 1, end: () => 5.0 };
  assert.equal(getWatermarkMs(ranges, 3.0), 2000);
});

test('getWatermarkMs: 无缓冲返回 null', () => {
  assert.equal(getWatermarkMs({ length: 0 }, 0), null);
  assert.equal(getWatermarkMs(null, 0), null);
});
