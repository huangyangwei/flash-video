# Tasks: add-live-detector

## 1. 纯逻辑核心（可测试层）

- [x] 1.1 新增 `src/lib/room-page.js`：从房间页 HTML 提取开播状态与 `flv_pull_url` 的宽容解析（找不到字段返回明确失败，不抛异常）；用直播中样本（/tmp/dy.html 抓取格式）写单测覆盖：直播中、字段缺失、空页面，验证 `node --test test/room-page.test.js` 通过
- [x] 1.2 新增 `src/lib/watch-decision.js`：状态跳变判定（未开播→开播只触发一次；脚本冷启动时已直播则触发一次）、失败退避计算（`min(interval × 2^失败次数, 300s)`、成功清零）、间隔与 origin 的参数解析与默认值；单测覆盖跳变沿矩阵、退避序列、参数默认值，验证 `node --test test/watch-decision.test.js` 通过

## 2. watch 脚本

- [x] 2.1 新增 `scripts/watch.mjs` + `npm run watch`：组装 1.1/1.2 纯逻辑——fetch 房间页（浏览器 UA、超时）、控制台打印生效配置与失败原因、开播时打印 flv 地址；验证：对真实房间（当前直播中）运行，冷启动即打印地址并唤起一次，随后静默轮询
- [x] 2.2 唤起动作：`child_process` 打开 `http://127.0.0.1:5173/?url=<encodeURIComponent(flv)>`，`--origin` 可覆盖；验证：以 `--origin http://127.0.0.1:9999` 运行，浏览器被打开到正确深链（无需页面真正可用）

## 3. 播放页自动开播与重试

- [x] 3.1 `src/player.js`：启动时读取 `?url=` 参数，走与手动粘贴相同的校验与开播路径，音频默认静音；参数缺失时入口不变；验证：`npm run dev` 后以带/不带参数的深链各打开一次，观察行为（实现于 src/main.js + headless Chrome 截图验证：深链自动回填并展开播放面板；⚠️ 形态修正为 hash 传参 `#/?url=`——vite dev 5.4.21 安全补丁对含编码 URL 的查询串 403，见 design D6）
- [x] 3.2 `src/player.js`：初始连接失败时按 2s/4s/8s 自动重试 3 次，UI 展示重试进度；播放中段断流仍走现有 15s 看门狗人工提示；重试逻辑进单测，验证 `npm test` 全部通过（纯逻辑 src/lib/connect-retry.js + 接线 LowLatencyPlayer）
- [x] 3.3 手动粘贴一条已过期的 flv 地址，确认重试进度出现且 3 次耗尽后回落到错误提示（不无限重试）（headless 验证：死地址注入后重试进度可见，2s/4s/8s 烧完弹"流已中断"框；与手动粘贴同一 startPlayback 路径）

## 4. 收尾

- [x] 4.1 `npm test` 全绿；README 补充 `npm run watch` 用法（参数、默认值、兜底说明）（29/29 通过）
- [ ] 4.2 归档时更新 CLAUDE.md：推翻"明确不做自动抓流"约束，记录实测依据与两个 spike 的状态（轮询安全间隔待校准；离播页面样本待抓取）

## 6. 需求修订：房间链接手动输入

- [x] 6.1 `src/lib/watch-decision.js` 增加房间输入归一化（完整直播间链接/纯房间号 -> 房间号，宽容查询参数），`parseWatchArgs` 报告参数是否被显式提供；单测覆盖
- [x] 6.2 `scripts/watch.mjs` 未提供 `--room` 时启动交互询问（node:readline，回车用默认房间，非法输入重问）；同步 README 用法；验证：管道喂入链接冷启动正确解析并轮询（⚠️ Node 21 readline/promises 在 stdin EOF 时 pending question 永不 settle 导致顶层 await 挂死 exit 13，改为竞速 close 事件修复）

## 7. 需求修订：监测配置上网页

- [x] 7.1 `src/lib/watch-engine.js` 轮询引擎（fetch/sleep 注入，start/stop/setConfig/getStatus，复用 room-page + watch-decision 纯逻辑）；单测覆盖开播提取、失败退避、停止、非法房间
- [x] 7.2 `scripts/live-watch-plugin.mjs` vite 插件 + `vite.config.js` 挂载：`/__watch/api` GET 状态 / POST start|stop|config
- [x] 7.3 `index.html` 监测面板（链接输入、间隔、开关按钮、状态行）+ `src/main.js` 接线：状态轮询刷新、开播自动 `startPlayback`（同址去重）；房间/间隔存 localStorage
- [x] 7.4 验证：`npm test` 全绿（38/38）；headless 浏览器实测全链路通过——API 启动监测 → 引擎拿到直播状态与新鲜 flv → 裸页面（无参数）自己轮询状态并自动开播，面板显示"直播中 · 已自动开播"

## Spike（不阻塞主线，真实环境机会驱动）

- [ ] 5.1 主播下播时抓一次房间页 HTML 存档，核对离播形态（status 字段值/是否存在），据此修订 `src/lib/room-page.js` 解析与测试样本（2026-09-09 首次尝试被风控验证码页挡住，真正的离播样本仍未取到）
- [x] 5.2 轮询风控观察：日常使用中记录不同间隔下是否出现验证码/拦截，形成间隔校准结论（写入 CLAUDE.md）（**首个实测结论 2026-09-09：3s 间隔数分钟内即触发验证码中间页**——6KB 壳页无任何数据字段；解析器已单独归类 `captcha` 并给出人话提示，退避熔断按设计兜住；安全间隔下限暂定 >10s，待继续校准）
