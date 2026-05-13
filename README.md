# toxy

`toxy` 是一个本地服务器驱动的 24 小时 AI 电台原型。

前端是播放器与聊天一体的界面，后端用 LLM 和规则层把你的听歌记录整理成 `taste.md`，再据此驱动推荐、切歌理由和电台语气。`taste.md` 不再是手写人设文案，而是从真实歌单和播放历史里“长出来”的口味文件。

## 当前这一版能做什么

- 提供播放器、聊天区、右侧 `taste / profile / sync` 面板
- 接收前端 `Sync` 面板提交的 JSON，并通过 `POST /api/taste/import` 生成新的 `taste.md`
- 支持本地文件导入 `POST /api/taste/import/local`
- 通过 `GET /api/profile` 读取当前口味画像和导入快照
- 初始化电台状态，并生成一份每日歌单占位结果
- 兼容 DeepSeek 风格的 LLM 接口

## taste.md 在这版项目里的角色

这个项目的核心不是“先写一个 DJ 人设”，而是“先把你的听歌数据转成可解释的 taste 文件”。

导入完成后，系统会基于 `listeningHistory` 推出：

- 反复出现的艺人和高权重曲目
- 偏好的流派、标签、年代和典型收听时段
- `hard no` 和应避免的能量走势
- 雨天、专注、疲惫、浪漫、对抗这几类 mood 的调歌 palette
- 电台该怎么说话，以及切歌时优先保护什么氛围

后续聊天、推荐、排队和切歌，都会依赖这份 `taste.md`。

## 导入格式

前端 `Sync` 面板和 `/api/taste/import` 接受同一份 JSON：

```json
{
  "platform": "netease",
  "displayName": "Toxy Listener",
  "sourceName": "music-app-api",
  "dislikes": ["festival EDM drops"],
  "listeningHistory": [
    {
      "title": "If",
      "artist": "Bread",
      "album": "Mellow Gold",
      "playedAt": "2026-05-05T23:48:00+08:00",
      "playCount": 12,
      "liked": true,
      "releaseYear": 1971,
      "genres": ["soft rock"],
      "tags": ["rainy", "gentle", "late-night"],
      "energy": "low"
    }
  ]
}
```

`platform` 和 `listeningHistory` 是必填。`displayName`、`sourceName`、`dislikes` 以及单曲上的扩展字段都是可选，但填得越完整，生成出来的 `taste.md` 越像真人。

## 字段怎样影响口味生成

- `displayName` / `sourceName`
  用来标记这次导入是谁、来自哪个数据源，也会进入 profile snapshot。
- `listeningHistory`
  这是主输入，不能为空；每条记录至少要能解析出 `title` 和 `artist`。
- `playCount`
  决定一首歌、一位艺人或一类风格在口味画像里的权重。高重复播放会明显拉高它们在 `Artists`、`Genres`、`Radio Rules` 里的存在感。
- `playedAt`
  用来推断收听场景，例如 `morning reset`、`focus window`、`evening commute`、`late-night drift`。
- `liked` / `skipped` / `dislikes`
  会影响 `Hard No` 和系统的避让策略。`dislikes` 是最直接的明确负反馈。
- `releaseYear`
  用来归纳年代偏好，写进 `Eras`。
- `genres` / `tags`
  会进入 `Genres`、`Mood Mapping`、`Signature Playlists`，也是最能提升 taste 质量的一组字段。
- `energy`
  会影响系统判断你能接受的能量爬坡速度，进而改写 `Radio Rules`。
- `mood`
  当前是辅助信息，主要用于扩展后续曲库和情绪映射。

## 结合你当前这批导入数据，README 应该怎么理解

仓库当前保存的导入快照来自一次本地音乐导入，时间是 `2026-05-07T06:20:33.342Z`，核心结果如下：

- 导入来源是 `local-files`
- 共导入 `600` 条记录
- 当前 top artists 是 `Imagine Dragons`、`Fall Out Boy`、`JVKE`、`Coldplay`、`Logic`、`宋冬野`、`AViVA`、`AWOLNATION`
- 当前源数据里没有稳定的 `genres`、`tags`、`releaseYear`，所以生成器回退到了更保守的默认口味骨架

这也是为什么现在的 `taste.md` 呈现为：

- `Tagline: Imagine Dragons tuned to late-night radio`
- `Scenes` 以 `late-night drift`、`focus window`、`rainy commute` 为主
- `Radio Rules` 明确要求“先稳住情绪，再解释选歌”，“默认控制能量，不要突然炸场”

换句话说，你现在这版 README 不应该再把“口味”写成抽象设想，而应该把它写成一条清晰的数据链路：

`导入歌单 -> 归一化 listeningHistory -> 生成 taste.md -> 用 taste 驱动电台`

如果你后续从网易云、QQ 音乐或自己的中转服务导入更完整的 `genres`、`tags`、`liked/skipped` 数据，这份 README 里的说明仍然成立，只是生成出的 `taste.md` 会更具体。

## 导入后的产物

一次成功导入后，当前版本会写出这些文件：

- `taste.md`
- `.data/taste.generated.md`
- `.data/taste-profile.json`
- `.data/taste-source.json`

同时系统会刷新当前电台状态；如果导入数据可映射为可播放曲库，还会同步更新播放库快照。

## 环境变量

复制 `.env.example` 为 `.env.local` 后按需填写：

```bash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=你的key
```

未配置时系统会回退到本地启发式 DJ。

## 启动

```bash
npm install
npm run dev
```

## 测试

```bash
npm test
```

## 文档

- 详细架构蓝图见 [docs/architecture.md](C:/Users/汤鑫宇/Documents/New project 5/docs/architecture.md)
