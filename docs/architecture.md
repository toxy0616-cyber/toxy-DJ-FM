# Toxy 架构蓝图

## 一句话定义

`toxy` 是一个由本地服务器承载、以 LLM 为后端核心、以真实听歌数据驱动 taste 的 24 小时 AI 电台系统。

## 核心原则

- 前端负责交互，不负责决策
- 后端负责理解、规划、编排和状态
- `taste.md` 是音乐数据抽象结果，不是拍脑袋写出来的人设
- 外部服务层只提供能力输入输出，不污染核心业务逻辑

## 分层设计

### 前端层

目标：提供一个稳定、沉浸、可控制的播放器 + 聊天体验。

职责：

- 播放器 UI
- 当前曲目、队列、情绪标签展示
- 聊天输入和回复展示
- taste/profile/sync 面板
- 用户显式控制：播放、暂停、切歌、同步 taste

当前对应：

- [app/page.tsx](C:/Users/汤鑫宇/Documents/New project 5/app/page.tsx)
- [components/toxy-radio.tsx](C:/Users/汤鑫宇/Documents/New project 5/components/toxy-radio.tsx)
- [app/globals.css](C:/Users/汤鑫宇/Documents/New project 5/app/globals.css)

### 后端核心层

目标：把“你现在说的话”和“你一直以来的口味”结合起来，做成一个连续的 DJ 大脑。

职责：

- 读取 `taste.md`
- 读取和维护电台状态
- 汇总聊天历史和上下文
- 调用 LLM 生成回复和选歌意图
- 调用音乐适配层落实成具体歌曲
- 更新队列、当前播放和理由

当前对应：

- [lib/orchestrator.ts](C:/Users/汤鑫宇/Documents/New project 5/lib/orchestrator.ts)
- [lib/radio-state.ts](C:/Users/汤鑫宇/Documents/New project 5/lib/radio-state.ts)
- [lib/providers/llm.ts](C:/Users/汤鑫宇/Documents/New project 5/lib/providers/llm.ts)

### taste 与数据层

目标：把原始听歌行为转成可解释、可复用、可被 LLM 消化的 taste 资产。

职责：

- 接收音乐 App 数据
- 清洗并标准化听歌记录
- 推导高频艺人、流派、时段、情绪、排斥项
- 生成 `taste.md`
- 保存导入快照和派生 profile

当前对应：

- [lib/taste-source.ts](C:/Users/汤鑫宇/Documents/New project 5/lib/taste-source.ts)
- [lib/taste-store.ts](C:/Users/汤鑫宇/Documents/New project 5/lib/taste-store.ts)
- [lib/taste.ts](C:/Users/汤鑫宇/Documents/New project 5/lib/taste.ts)
- [app/api/taste/import/route.ts](C:/Users/汤鑫宇/Documents/New project 5/app/api/taste/import/route.ts)

### 外部服务层

目标：接外部能力，但不把平台差异带进业务核心。

职责：

- 音乐平台 API
- LLM API
- 天气 API
- 日程/Calendar API
- 智能音箱或其他设备接口

这一层统一处理 API Key、权限、请求封装和失败回退。

当前对应：

- [lib/providers/music.ts](C:/Users/汤鑫宇/Documents/New project 5/lib/providers/music.ts)
- [lib/providers/llm.ts](C:/Users/汤鑫宇/Documents/New project 5/lib/providers/llm.ts)

## 运行闭环

### 闭环 A：聊天调歌

1. 用户在前端输入一句话
2. 前端调用 `/api/chat`
3. 后端读取当前状态、taste、聊天历史
4. LLM 生成回复、情绪、选歌意图
5. 音乐适配层选择具体曲目
6. 前端刷新当前播放、理由和聊天内容

### 闭环 B：taste 同步

1. 用户从音乐 App 获取原始数据
2. 前端或中转服务整理成 `TasteImportPayload`
3. 调用 `/api/taste/import`
4. 后端分析并生成新的 `taste.md`
5. 后续所有选歌与对话逻辑使用新的 taste

## 近期开发顺序

### P1：把 taste 导入做成真正的平台接入

- 先确定你的主力音乐平台
- 补平台专属抓取器或中转接口
- 不再只靠手动粘贴 JSON

### P2：让推荐逻辑从演示曲库升级到真实音乐源

- 把 `MusicProvider` 接到真实搜索/播放接口
- 支持根据 LLM 意图搜索候选曲目
- 处理无版权、无结果、鉴权失败等情况

### P3：增强上下文感知

- 加入天气
- 加入日程
- 加入时间段与历史场景偏好
- 让每日歌单从占位逻辑升级为真实调度逻辑

### P4：设备联动

- 接入音箱、投屏或家庭设备
- 支持本地播放与外部设备切换

## 风险与注意点

- 音乐平台 API 很可能存在权限、频控或稳定性问题
- 各平台返回字段不统一，必须坚持统一导入协议
- `taste.md` 可以是结果文件，但长期状态可能还需要数据库或缓存层
- LLM 不应直接决定“播放链接”，而应先输出意图，再交给音乐层执行

## 下一步建议

正式制作建议从这三个点开始：

1. 确定你优先接入的音乐平台
2. 为这个平台实现专属导入器
3. 把当前演示曲库替换成真实音乐搜索与播放
