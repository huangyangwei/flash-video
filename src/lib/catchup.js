// 追帧决策（纯逻辑，无 DOM）：给定缓冲水位与设置，决定播放动作。
// 策略（见 design.md D3）：治理全靠追帧，缓冲基本不扩——
//   水位 >= 跳帧阈值        -> jump  一跃到直播边缘（最新关键帧）
//   水位 >= 变速阈值        -> speed 视频倍率回吐（带迟滞，避免 1x/x1.1 抖动）
//   否则                    -> normal
// 变速关闭迟滞：回落到阈值的 50% 以下才恢复 1.0x。

export const ACTION = {
  NORMAL: 'normal',
  SPEED: 'speed',
  JUMP: 'jump',
};

// prevAction: 上一轮动作（用于迟滞）；settings 为 sanitizeSettings 的产物
export function decideAction(watermarkMs, settings, prevAction) {
  if (!settings.catchupEnabled) return ACTION.NORMAL;

  const { speedThresholdMs, jumpThresholdMs, speedRate } = settings;

  if (jumpThresholdMs !== null && watermarkMs >= jumpThresholdMs) {
    return ACTION.JUMP;
  }

  if (prevAction === ACTION.SPEED) {
    // 迟滞：正在变速时，回落到一半阈值以下才停止，防止倍率来回抖动
    if (watermarkMs >= speedThresholdMs / 2) {
      return ACTION.SPEED;
    }
    return ACTION.NORMAL;
  }
  if (watermarkMs >= speedThresholdMs) {
    return ACTION.SPEED;
  }
  return ACTION.NORMAL;
}

// 从 buffered 时间轴计算水位（ms）。返回 null 表示无从计算（无缓冲）。
// buffered: VideoPlaybackQuality 之外的 TimeRanges；currentTime 秒。
export function getWatermarkMs(buffered, currentTime) {
  if (!buffered || buffered.length === 0) return null;
  // 直播流只关心最近一段缓冲的末端
  const end = buffered.end(buffered.length - 1);
  const value = (end - currentTime) * 1000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
