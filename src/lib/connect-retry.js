// 初始连接重试决策（纯逻辑）：覆盖"开播瞬间状态已翻、CDN 流未就绪"场景。
// 规则（design D5）：只在从未收到过媒体数据时重试，递增退避共 3 次
// （2s/4s/8s）；播放中段的断流不在此处理（走 15s 看门狗 -> 人工提示）。

export const CONNECT_RETRY_DELAYS_MS = [2000, 4000, 8000];

/**
 * @param {object} p
 * @param {number} p.failedAttempts 已连续失败的初始连接次数（首次失败为 1）
 * @param {boolean} p.hasMedia 是否已收到过媒体数据（收到过 = 非初始连接问题）
 * @param {boolean} p.isNetworkError 是否为网络类错误（格式/媒体错误重试无意义）
 * @returns {{retry:boolean, delayMs?:number, attempt?:number}} attempt 为即将进行的重试序号（1 起）
 */
export function retryPlan({ failedAttempts, hasMedia, isNetworkError }) {
  if (hasMedia || !isNetworkError) return { retry: false };
  const attempt = failedAttempts; // 第 1 次失败 -> 第 1 次重试
  if (attempt > CONNECT_RETRY_DELAYS_MS.length) return { retry: false };
  return { retry: true, delayMs: CONNECT_RETRY_DELAYS_MS[attempt - 1], attempt };
}
