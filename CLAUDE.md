# CLAUDE.md

flash-video——单人自用的低延迟直播播放页，为抖音直播间抢码场景而生。

## 项目定位与硬约束

- **目标**：粘贴从抖音页面抓取的 `.flv` 地址，用最小缓冲 + 追帧播放同一条公开流，比抖音 Web 观众快 1~2s
- **用户偏好**：只在乎画面，不在乎声音 → 音频默认静音（这个决定消解了 MSE 单元素变速难题，倍率上限才敢放到 2.0x）
- **硬指标**（进行中）：码出现在流帧 → 复制到剪贴板 < 200ms
- **明确不做**：服务器、多观众、自动抓流（地址手动 DevTools 抓）、RTC/自建传输、付费云方案

## 技术要点（决策原因见 openspec/changes/add-low-latency-viewer/design.md）

- mpegts.js + MSE，`enableStashBuffer: false`、`stashInitialSize: 384`，内置 liveBufferLatencyChasing 关闭（追帧自己实现）
- 追帧三旋钮：变速阈值（默认 1000ms）/ 变速倍率 1.05~2.0x（默认 1.1x）/ 跳帧阈值（默认 2000ms，可禁用）
- 策略：治理全靠追帧，缓冲基本不扩——激进需求靠降跳帧阈值表达，不靠提高倍率
- 15s 看门狗：缓冲不增长且断流 → 提示重贴地址
- 实测：水位常驻 ~410ms，比抖音 Web 快 ~1s（抖音 Web 缓冲其实只有 ~1.5s，"比别人慢几秒"的别人大概率是 App 观众）

## 当前状态（2026-09-09）

- change `add-low-latency-viewer`：**7/13 任务完成**，剩余任务全部需要真实环境验证（浏览器 + 真实 .flv 地址）
- 仓库：https://github.com/huangyangwei/flash-video
- 待办：
  - [ ] 3.2/3.3/4.1/4.2：用户在播放页把阈值压到水位以下即可验证（变速/跳帧/设置即时生效/持久化）
  - [ ] 2.3/2.4：无效地址、断流重贴验证
  - [ ] 5.1 延迟对比：验收基准需重新校准——原定"领先抖音 Web 2s"过于乐观，应改为与**抖音 App 观众**对比
  - [ ] 5.1 建议补充:与抖音App观众双开对比,追平或领先即算原始问题解决

## 下一步计划（已探索未立项）

1. **OCR handoff（方案 B）**：用户有一个 C++ OCR 工具（Windows.Media.Ocr 引擎，20~100ms/帧，屏幕区域截屏 + ROI 框选 + 实时识别）。计划改造为 FFmpeg 直接拉流解码 + 帧坐标 ROI + 最新帧优先循环 + 识别校验/去重 + SetClipboardData。200ms 预算已验证可行（最坏 ~161ms）。web 侧配套：播放页加"把当前地址推给 OCR 工具"按钮（localhost POST，端口可配）
2. 建议的 change 名：`add-ocr-handoff`，scope = 本项目 web 侧 + 与 C++ 工具的接口契约（C++ 侧在用户自己的工具仓库改）

## 工作约定

- 用 OpenSpec 工作流（/opsx:explore → /opsx:propose → /opsx:apply → /opsx:archive）
- spec 变动需用户确认后才能动 artifacts
- 测试：`npm test`（node --test，覆盖追帧决策与设置约束的纯逻辑）
