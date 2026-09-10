import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryPlan, CONNECT_RETRY_DELAYS_MS } from '../src/lib/connect-retry.js';

test('初始连接失败：按 2s/4s/8s 递增重试，共 3 次（spec: 开播瞬间流未就绪）', () => {
  assert.deepEqual(retryPlan({ failedAttempts: 1, hasMedia: false, isNetworkError: true }),
    { retry: true, delayMs: 2000, attempt: 1 });
  assert.deepEqual(retryPlan({ failedAttempts: 2, hasMedia: false, isNetworkError: true }),
    { retry: true, delayMs: 4000, attempt: 2 });
  assert.deepEqual(retryPlan({ failedAttempts: 3, hasMedia: false, isNetworkError: true }),
    { retry: true, delayMs: 8000, attempt: 3 });
  assert.deepEqual(retryPlan({ failedAttempts: 4, hasMedia: false, isNetworkError: true }),
    { retry: false }); // 重试耗尽 -> 人工提示（spec: 不无限循环静默重试）
});

test('已收到过媒体数据 -> 不重试（中段断流走看门狗，spec 边界）', () => {
  assert.equal(retryPlan({ failedAttempts: 1, hasMedia: true, isNetworkError: true }).retry, false);
});

test('非网络错误（格式/媒体错误）-> 不重试，直接报错', () => {
  assert.equal(retryPlan({ failedAttempts: 1, hasMedia: false, isNetworkError: false }).retry, false);
});

test('退避序列常量与 spec 一致（2s/4s/8s）', () => {
  assert.deepEqual(CONNECT_RETRY_DELAYS_MS, [2000, 4000, 8000]);
});
