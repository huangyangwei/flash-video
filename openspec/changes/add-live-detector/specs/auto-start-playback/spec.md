# auto-start-playback — Delta

## Purpose

让播放页支持无人值守自动开播：通过 `?url=` 深链参数直接开始播放，跳过手动粘贴环节，与 live-detection 的唤起动作衔接。

## ADDED Requirements

### Requirement: 深链参数自动开播
播放页 SHALL 识别 URL hash 中的 `#/?url=<flv地址>` 参数：参数存在时校验并直接开始播放，行为与手动粘贴有效地址一致（音频默认静音）；参数缺失时页面保持现有手动粘贴入口不变。深链 MUST 通过 hash 传参（而非查询串），以不经过服务器、不受 dev server 与静态托管对查询串的限制。

#### Scenario: 深链打开即开播
- **WHEN** 用户（或 watch 脚本）以 `http://127.0.0.1:5173/#/?url=<有效flv地址>` 打开播放页
- **THEN** 页面无需任何用户操作即开始播放该直播流，画面从直播边缘开始

#### Scenario: 深链地址无效
- **WHEN** 深链携带的地址无法建立连接或格式不正确
- **THEN** 播放页按"初始连接失败"处理（见 low-latency-playback 的自动重试），重试耗尽后展示错误提示与手动粘贴入口，不崩溃

#### Scenario: 无参数打开
- **WHEN** 用户以不带 `#/?url=` 参数的地址打开播放页
- **THEN** 页面展示现有手动粘贴入口，行为与现状一致
