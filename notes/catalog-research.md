# PIKASONIC 目录研究与同步说明

本项目的目标是尽量完整地整理 PIKASONIC 的公开作品。当前快照收录 **139 个曲目 / 103 个 Apple 发行记录**，对应 **136 个 Apple 曲目 ID 去重为 132 首，加上 7 个独立上传曲目或不同版本**。有日期的范围为 **2017-04-04 至 2026-10-07**。数据核对日期：2026-10-15。数量不是“艺人历史上全部作品”的保证；首页应将其表述为“已收录曲目”或“公开发行目录”。

## 数据来源

- Apple 主艺人页：[PIKASONIC / 1450218337](https://music.apple.com/jp/artist/pikasonic/1450218337)。美区和日区的 `lookup` 分别检索 `song` 与 `album`，再展开所有发现发行的 `song` 列表。
- Apple 同名艺人页：[PIKASONIC / 1738111555](https://music.apple.com/jp/artist/pikasonic/1738111555)。仅发现《今天不是明天 (feat. 兰音Reine)》。此条保留 `alternateArtistPage: true`，便于审阅同名艺人归属。
- Apple 搜索接口同时搜索 `PIKASONIC` 与 `PIKASONIC Remix`，补充以其他艺人为主署名的合作、混音及合辑曲目。
- [MusicBrainz 艺人关系](https://musicbrainz.org/artist/81ce14d7-f806-4015-ab6c-84d081991c3f) 用于核对身份与公开频道地址。其艺人记录为日本、大阪，含 YouTube、Spotify、SoundCloud 和 Bandcamp 链接。MusicBrainz 未用于曲目数量。
- [API 说明](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) 是同步实现参考。API 默认限速约 20 次 / 分钟；脚本每个请求默认间隔 3.1 秒，并重试网络错误。

同步过程中未下载音频、歌词或封面图片文件。目录仅保留远程封面 URL 和可回溯的 Apple 发行页链接；`releases[].copyright` 保留平台提供的版权文字。不会将外部美术、音乐或平台数据声明为 MIT 许可。

## 如何同步

在项目根目录执行：

```sh
node scripts/sync-catalog.mjs
```

更新独立上传补遗并合并进目录：

```sh
node scripts/sync-independent.mjs
node scripts/sync-catalog.mjs --merge-independent
node scripts/sync-independent.mjs --youtube-from-snapshot
```

独立同步脚本读取官方 SoundCloud 访客页面提供的元数据及分页，并核对官方 YouTube 频道与 Uploads 列表。Windows 使用系统 PowerShell 的网络代理设置，其余系统使用 Node.js fetch；所有请求均不需要登录或个人令牌。`--merge-independent` 使用已保存的 Apple 快照，不重复网络查询。完整的 Apple 同步也会自动合并现有补遗。

`public/data/youtube.json` 为前端提供精确的官方 YouTube 渠道映射，目前 139 首中有 76 首匹配，其余使用明确标注的搜索入口。结构为 `{ updatedAt, channelUrl, coverage, matches: { [catalogTrackId]: { url, title, id } } }`。映射仅使用已核对的 100 条官方视频，按曲名、署名 feature 与版本匹配，视频时长容差为 8 秒。完整 feature 名单优先于泛化曲名，避免将可不和 nakotanmaru 的不同人声互配；Mixed、Remix、VIP、游戏短版标记保留。同步独立目录时会自动导出映射，最后一条无网络命令可在目录合并后刷新新曲目的映射。

不需要 API 密钥、第三方 npm 依赖或音频授权令牌。脚本使用 Node.js 内置 `fetch`，建议 Node.js 20 或更新版本。成功后写入 `public/data/catalog.json`。网络错误重试失败时停止并保留原快照；意外少于 100 首、缺失标题 / 署名 / 来源 / 封面时也不会覆盖现有文件。

该文件包含 `updatedAt`、查询的 `requests`、来源、地区、覆盖限制和统计。来源接口变动或下架会影响后续同步结果，提交更新时应审阅差异。

## 数据字段

```text
{
  schemaVersion: 1,
  updatedAt: ISO-8601 timestamp,
  artist: { name, appleArtistId, appleArtistUrl, alternateAppleArtistId,
            musicBrainzId, links: { youtube, soundcloud, bandcamp, spotify } },
  sources: [{ name, url, description }],
  coverage: { regions, approach, scope, limitations, failedRequests },
  stats: { trackCount, releaseCount, appleTrackCount, requestCount,
           earliestRelease, latestRelease },
  requests: [{ url, resultCount }],
  tracks: [{
    id, title, artist, album, releaseDate, durationMs, genre,
    artworkUrl, sourceUrl, appleTrackId, appleCollectionId,
    aliases, artistAliases, albumAliases, stores, alternateArtistPage,
    kind, tags, sourceName, genreDetails: [{ genre, sourceName, sourceUrl }],
    externalSources?: [{ name, url, title, uploadDate }],
    releases: [{ appleTrackId, appleCollectionId, title, releaseDate,
                 sourceUrl, artworkUrl, copyright }]
  }]
}
```

`title` / `artist` / `album` 优先采用日本商店返回的文字。美区的罗马字或英语标题保存在 `aliases`，可与日文标题共同搜索。流派优先使用美区值，便于统一筛选。`releaseDate` 为 `YYYY-MM-DD`，`durationMs` 的单位为毫秒。`artworkUrl` 使用 Apple 图片 URL 的 600 × 600 尺寸。

`kind` 为依据平台标题识别的 `original`、`remix`、`instrumental` 或 `alternate`；不是人工听辨后的音乐分类。`tags` 中的 `collaboration` 依据多人署名或 `feat.` 元数据生成，不能用来替代完整的创作人员表。

不同商店的同一 `trackId` 先合并为多语言别名；若不同发行的英语曲名、归一化艺人名单完全相同且时长差不超过 1 秒，再合并显示曲目并保留所有 `releases`。这可合并单曲 / 合辑重复收录，同时保留不同混音、VIP、伴奏、清唱版本。代表记录优先采用较早的发行日期。

跨平台合并优先匹配完整曲名及 feature 名单，再匹配去掉宣传括号与 feature 后的曲名，并要求时长接近。存在多个同名版本时只有时长最近值明显不同才合并。独立平台的真实流派保存在 `genreDetails`，例如 Nation 的 SoundCloud 流派为 Future House、Interstellar 为 Melodic Dubstep、Where Are You Gone 为 Hardstyle、Climax 为 Bass house；这些均是平台原值，未对歌曲进行主观细分类。YouTube 不提供逐曲流派时留空。

独立补遗 `public/data/supplemental.json` 当前包含 79 首 SoundCloud 上传和 4 个 YouTube 版本。79 首中 76 首匹配已有 Apple 曲目并补充来源，3 首为额外作品。YouTube 补遗未获取精确发行日期，因此 `releaseDate` 为 `''`；其 `durationMs` 表示公开视频时长，封面字段为原公开视频缩略图。SoundCloud 日期表示原页面的发行 / 展示 / 上传日期，和商业平台日期不一定相同。

## 核对结果与边界

- 主艺人歌曲查询在美区返回 131 首，在日区返回 132 首。搜索与发行展开进一步发现漏在主目录以外的署名版本。
- 补充记录包括《After Rain》（游戏 OST，2026-10-07）、《Summer Rain (PIKASONIC Remix)》、《Are You Still There (PIKASONIC Remix)》和《Sakura (feat. Kimura Rin) [Pikasonic Remix] [Mixed]》。混音不能仅靠主艺人作品列表找全。
- 搜索中的《Best Buddies (PikaSonic)》由 BrainRot Media Ava 署名，与本项目艺人无关。脚本不会仅因普通歌名中含有 “PikaSonic” 就接纳记录。
- 《2016-2017》在 Apple 平台上的发行日为 2026-08-15；此日期表示当前发行记录，不表示音乐一定创作于 2026 年。标题和平台元数据按来源原样保留。
- 《8BLUE》在合辑和单曲重复收录，合并后保留两个来源；其他单曲 / 合辑重复也保留在 `releases`。
- 音乐人团体“ナナツカゼ / Nanatsukaze”的曲目，只有明确署名 PIKASONIC 的记录自动纳入。仅署名团体名的作品应由贡献者核实制作人来源后补录，不能盲目归为个人作品。
- SoundCloud 官方用户 ID 为 294273258，其资料页计数为 108 首上传，但当前访客曲目接口仅返回 79 首且下一页为空。已把这 79 首全部核对并保留，不能把资料页计数误称为可访问或已收录数量。
- SoundCloud 新补回《Climax》《Good Morning And Diamond 60s》《Rese》，将早期可验证作品延伸至 2017 年。《Climax》原页面类型为 Bass house，《Good Morning And Diamond 60s》为 Melodic Drumstep。
- YouTube 核对了频道首屏和官方 Uploads 播放列表的 100 条视频；续页接口未返回更多条目。新增《Space Walk (PIKASONIC Remix)》《Liyue Battle BGM (PIKASONIC Remix)》、游戏短版《Skyfall [CHRONO CIRCLE]》以及独立完整的《Sakura (ft.Kimura Rin) [PIKASONIC Remix]》。完整 Sakura 混音与 Apple 的 `[Mixed]` DJ 版时长明显不同，分开保留。普通官方 MV、Performance Video、预告和混音合集没有重复计作新歌曲。
- 官方公开链接可见于 MusicBrainz 关系。Bandcamp 的音乐页此次没有展示发行列表；旧主页链接 `pikasonicmusic.com` 未能访问，未采用其内容。未经核实的 `pikasonic.com` 域名不作为官网来源。
- YouTube、SoundCloud、Bandcamp 独占、未发行、已下架、游戏内独占和不同地区不可见的作品可能缺失。Apple 的艺术家归属也可能发生错误；保留来源与同名艺人标记有助于纠错。

已抽样请求 8 张代表封面的 600 × 600 URL，均返回 HTTP 200，包括 Reflect、8BLUE、Haruka、Infinity、Nostalgia、Lockdown 和 Dreamland。全部条目的必要字段、时长和流派均非空。

此目录仅提供可验证的发行元数据，未编造任何“官方创作背景”、作曲动机、歌词含义或听感评论。作品解读应有明确作者和来源；主观听感应标注为个人解读。非营利声明不能替代版权授权或自动排除侵权风险。

## YouTube 补遗的逐曲流派核验

2026-10-15 实际读取 4 个官方视频的公开观看页，核查作者描述中是否存在 `#FutureBass`、`Genre` 或其他明确逐曲流派：

| 曲目                                     | 官方视频                                    | 核验结果                                                                                                            |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Space Walk (PIKASONIC Remix)             | https://www.youtube.com/watch?v=0F-3yIq0sfM | 观看页返回 `LOGIN_REQUIRED`，原因是 “Sign in to confirm you’re not a bot”；未读取到曲目描述。                       |
| Skyfall [CHRONO CIRCLE]                  | https://www.youtube.com/watch?v=evVIHM_0uqQ | 描述可读取，仅说明该曲收录于「クロノサークル」、提供下载 / 流媒体链接及两位艺人的社交链接，没有明确曲风或相关标签。 |
| Liyue Battle BGM (PIKASONIC Remix)       | https://www.youtube.com/watch?v=nH93I4UryqQ | 观看页返回 `LOGIN_REQUIRED`，原因是 “Sign in to confirm you’re not a bot”；未读取到曲目描述。                       |
| Sakura (ft.Kimura Rin) [PIKASONIC Remix] | https://www.youtube.com/watch?v=lr5ItbokMfQ | 观看页返回 `LOGIN_REQUIRED`，原因是 “Sign in to confirm you’re not a bot”；未读取到曲目描述。                       |

因此这 4 条的 `genre` 保持空值，`genreDetails` 不添加推测分类，由界面显示“曲风待核实”。不能将未读取到描述解释为“艺人没有标注流派”，也不能把原版或 DJ Mixed 版的平台流派未经核对转用于独立混音及游戏短版。

可使用 `node scripts/sync-independent.mjs --inspect-video-genres` 复查公开描述与访问状态；该命令只输出核验内容，不改目录、排序、ID 或平台映射。
