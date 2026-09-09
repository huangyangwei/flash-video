import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, DEFAULT_SETTINGS, MIN_RATE, MAX_RATE } from '../src/lib/settings.js';

test('空输入回落默认值', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('junk'), DEFAULT_SETTINGS);
});

test('合法设置原样保留', () => {
  const s = sanitizeSettings({
    catchupEnabled: false,
    speedThresholdMs: 800,
    speedRate: 1.3,
    jumpThresholdMs: 3000,
  });
  assert.equal(s.catchupEnabled, false);
  assert.equal(s.speedThresholdMs, 800);
  assert.equal(s.speedRate, 1.3);
  assert.equal(s.jumpThresholdMs, 3000);
});

test('倍率超出范围约束到边界（spec: 变速范围约束）', () => {
  assert.equal(sanitizeSettings({ speedRate: 3.0 }).speedRate, MAX_RATE);
  assert.equal(sanitizeSettings({ speedRate: 0.5 }).speedRate, MIN_RATE);
  assert.equal(MAX_RATE, 2.0);
  assert.equal(MIN_RATE, 1.05);
});

test('跳帧阈值 null 表示禁用', () => {
  assert.equal(sanitizeSettings({ jumpThresholdMs: null }).jumpThresholdMs, null);
  assert.equal(sanitizeSettings({ jumpThresholdMs: undefined }).jumpThresholdMs, null);
});

test('非法数值字段回落默认', () => {
  const s = sanitizeSettings({ speedThresholdMs: 'abc', speedRate: NaN });
  assert.equal(s.speedThresholdMs, DEFAULT_SETTINGS.speedThresholdMs);
  assert.equal(s.speedRate, DEFAULT_SETTINGS.speedRate);
});
