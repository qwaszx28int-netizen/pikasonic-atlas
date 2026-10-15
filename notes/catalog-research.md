# PIKASONIC 目录研究与同步说明

本项目整理 PIKASONIC 的个人、合作、混音与可核实制作作品，也纳入ナナツカゼ（Nanatsukaze）的独立组合目录。当前快照收录 **170 个曲目 / 版本、120 个 Apple 发行记录**，对应 **158 个 Apple 曲目 ID 去重为 154 首，加上 16 个独立上传作品或版本**。有日期的范围为 **2017-04-04 至 2026-10-07**，核对日期为 2026-10-15。数量不是“艺人历史上全部作品”的保证；首页应将其表述为“已收录曲目”或“公开发行目录”。

## 数据来源

- Apple 主艺人页：[PIKASONIC / 1450218337](https://music.apple.com/jp/artist/pikasonic/1450218337)。美区和日区的 `lookup` 分别检索 `song` 与 `album`，再展开所有发现发行的 `song` 列表。
- Apple 同名艺人页：[PIKASONIC / 1738111555](https://music.apple.com/jp/artist/pikasonic/1738111555)。仅发现《今天不是明天 (feat. 兰音Reine)》。此条保留 `alternateArtistPage: true`，便于审阅同名艺人归属。
- Apple 组合艺人页：[ナナツカゼ / 1685618009](https://music.apple.com/jp/artist/%E3%83%8A%E3%83%8A%E3%83%84%E3%82%AB%E3%82%BC/1685618009)。美区、日区的歌曲与发行查询及发行展开共同核对组合目录，不以是否含 PIKASONIC 个人署名作为收录条件。
- Apple 搜索接口同时搜索 `PIKASONIC`、`PIKASONIC Remix`、`ナナツカゼ` 与 `Nanatsukaze`，补充以其他艺人为主署名的合作、混音及合辑曲目。
- [ナナツカゼ官方 YouTube 频道](https://www.youtube.com/@Nanatsukaze_)（频道 ID `UCE8B2xQ4Y3Mwl9NduvwyFkQ`）的公开简介列出 nakotanmaru 的 Compose / Lyrics / Vocal 与 PIKASONIC 的 Compose / Arrange，并链接[组合官网](https://www.nanatsukaze.com/)。PIKASONIC 官方[《春めく》预告](https://www.youtube.com/watch?v=3uXtK0e8hlw)也明确介绍组合身份；该预告本身不计入歌曲数量。
- [学園アイドルマスター Gakuen Label 的《海奏ララバイ》发行页](https://gakuen-label.idolmaster-official.jp/discography/iik-p-jujn_u)核实制作参与及发行链接：作词 nakotanmaru，作曲、编曲 PIKASONIC；歌曲演唱署名保持平台的初星学園、秦谷美鈴，不改写成组合主唱作品。
- 网易云公开艺人接口分别核对 [PIKASONIC / 13499634](https://music.163.com/api/artist/13499634) 与 [ナナツカゼ / 56672609](https://music.163.com/api/artist/56672609)。它们用于核对平台直达链接与署名，不用艺人页首批热歌数量证明完整目录。
- [MusicBrainz 艺人关系](https://musicbrainz.org/artist/81ce14d7-f806-4015-ab6c-84d081991c3f) 用于核对身份与公开频道地址。其艺人记录为日本、大阪，含 YouTube、Spotify、SoundCloud 和 Bandcamp 链接。MusicBrainz 未用于曲目数量。
- [API 说明](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) 是同步实现参考。API 默认限速约 20 次 / 分钟；脚本每个请求默认间隔 3.1 秒，并重试网络错误。

同步过程中未下载音频、歌词或封面图片文件。目录仅保留远程封面 URL 和可回溯的公开来源页链接；`releases[].copyright` 保留 Apple 平台提供的版权文字。不会将外部美术、音乐或平台数据声明为 MIT 许可。

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

只更新已核实的ナナツカゼ官方视频补遗与平台链接时，可使用保存的公开清单，无需再次抓取整个 PIKASONIC 频道：

```sh
node scripts/sync-independent.mjs --nanatsukaze-from-snapshot
node scripts/sync-catalog.mjs --merge-independent
node scripts/sync-independent.mjs --youtube-from-snapshot
node scripts/sync-netease.mjs --artists-only
```

`public/data/official-videos.json` 保存核实过的组合官方频道、《海奏ララバイ》与《真空都市》的官方 Topic 视频，并明确标注排除的预告、片段与串烧。`--nanatsukaze-from-snapshot` 只更新补遗，目录合并和 YouTube 映射分别由后续命令完成。`--artists-only` 使用两个已核实的网易云艺人页补充直达链接，保留此前的精确匹配；它不会混合两个艺人页的热歌排名。

独立同步脚本读取官方 SoundCloud 访客页面提供的元数据及分页，并核对官方 YouTube 频道与 Uploads 列表。Windows 使用系统 PowerShell 的网络代理设置，其余系统使用 Node.js fetch；所有请求均不需要登录或个人令牌。`--merge-independent` 使用已保存的 Apple 快照，不重复网络查询。完整的 Apple 同步也会自动合并现有补遗。

`public/data/youtube.json` 为前端提供精确的官方 YouTube 渠道映射。目前 **170 个曲目 / 版本中有 110 个直达链接、60 个搜索入口**；共审阅 **136 条视频**，包括原 PIKASONIC 频道 100 条、组合官方频道 33 条和官方 Topic 3 条。组合有 32 个直达链接，Apple 独有的 4 个伴奏版仍使用搜索；《海奏ララバイ》主唱、伴奏均有官方 Topic 直达。结构为 `{ updatedAt, channelUrl, additionalSources, coverage, matches: { [catalogTrackId]: { url, title, id } } }`。映射按曲名、署名 feature 与版本匹配，视频时长容差为 8 秒，明确排除串烧和非完整片段。完整 feature 名单优先于泛化曲名，避免将可不和 nakotanmaru 的不同人声互配；Mixed、Remix、VIP、伴奏和游戏短版标记保留。同步独立目录时会自动导出映射，`--youtube-from-snapshot` 可在目录合并后使用保存的清单刷新映射。

`public/data/netease.json` 当前提供 **146 个核实的直达链接、24 个搜索入口**。组合 Apple 目录的 27 个版本全部匹配；9 个 YouTube 独立伴奏及《海奏ララバイ》伴奏尚无核实的网易云直达记录。匹配要求已核实艺人身份、精确标题或目录别名、兼容的人声及版本标记，以及不超过 3.5 秒的时长差；不按近似歌名猜测链接。热歌排序只读取 PIKASONIC 艺人页的 50 条 `hotSongs` 快照，并优先使用其曲目 ID；组合页只用于校对入口，未将两张榜的排名拼为一个热度榜。未匹配项由前端按相应艺人或组合名生成明确标注的搜索入口。

不需要 API 密钥、第三方 npm 依赖或音频授权令牌。脚本使用 Node.js 内置 `fetch`，项目推荐 Node.js 24，最低 Node.js 22.18。成功后写入 `public/data/catalog.json`。网络错误重试失败时停止并保留原快照；意外少于 100 首、缺失标题 / 署名 / 来源 / 封面时也不会覆盖现有文件。

该文件包含 `updatedAt`、查询的 `requests`、来源、地区、覆盖限制和统计。来源接口变动或下架会影响后续同步结果，提交更新时应审阅差异。

## 数据字段

```text
{
  schemaVersion: 1,
  updatedAt: ISO-8601 timestamp,
  artist: { name, appleArtistId, appleArtistUrl, alternateAppleArtistId, relatedProjects,
            musicBrainzId, links: { youtube, soundcloud, bandcamp, spotify } },
  sources: [{ name, url, description }],
  coverage: { regions, approach, scope, limitations, failedRequests },
  stats: { trackCount, releaseCount, appleTrackCount, nanatsukazeTrackCount, requestCount,
           earliestRelease, latestRelease },
  requests: [{ url, resultCount }],
  tracks: [{
    id, title, artist, album, releaseDate, durationMs, genre,
    artworkUrl, sourceUrl, appleTrackId, appleCollectionId,
    aliases, artistAliases, albumAliases, stores, alternateArtistPage,
    kind, tags, sourceName, genreDetails: [{ genre, sourceName, sourceUrl }],
    projects?: [relatedProjectName],
    externalSources?: [{ name, url, title, uploadDate, description }],
    releases: [{ appleTrackId, appleCollectionId, title, releaseDate,
                 sourceUrl, artworkUrl, copyright }]
  }]
}
```

`title` / `artist` / `album` 优先采用日本商店返回的文字。美区的罗马字或英语标题保存在 `aliases`，可与日文标题共同搜索。流派优先使用美区值，便于统一筛选。`releaseDate` 为 `YYYY-MM-DD`，`durationMs` 的单位为毫秒。`artworkUrl` 使用 Apple 图片 URL 的 600 × 600 尺寸。

`kind` 为依据平台标题识别的 `original`、`remix`、`instrumental` 或 `alternate`；不是人工听辨后的音乐分类。`tags` 中的 `collaboration` 依据多人署名、`feat.` 元数据或已核实的组合身份生成，不能用来替代完整的创作人员表。`projects: ['ナナツカゼ']` 标记组合目录；组合歌曲仍保留平台原艺人署名。

不同商店的同一 `trackId` 先合并为多语言别名；若不同发行的英语曲名、归一化艺人名单完全相同且时长差不超过 1 秒，再合并显示曲目并保留所有 `releases`。这可合并单曲 / 合辑重复收录，同时保留不同混音、VIP、伴奏、清唱版本。代表记录优先采用较早的发行日期。

跨平台合并优先匹配完整曲名及 feature 名单，再匹配去掉宣传括号与 feature 后的曲名，并要求时长接近。存在多个同名版本时只有时长最近值明显不同才合并。独立平台的真实流派保存在 `genreDetails`，例如 Nation 的 SoundCloud 流派为 Future House、Interstellar 为 Melodic Dubstep、Where Are You Gone 为 Hardstyle、Climax 为 Bass house；这些均是平台原值，未对歌曲进行主观细分类。YouTube 不提供逐曲流派时留空。

独立补遗 `public/data/supplemental.json` 当前包含 79 首 SoundCloud 上传、4 个 PIKASONIC YouTube 版本与 9 个ナナツカゼ官方 YouTube 伴奏版。79 首 SoundCloud 上传中 76 首匹配已有 Apple 曲目并补充来源，3 首为额外作品；13 个 YouTube 版本均单独保留。YouTube 补遗未获取精确发行日期，因此 `releaseDate` 为 `''`；其 `durationMs` 表示公开视频时长，封面字段为原公开视频缩略图。SoundCloud 日期表示原页面的发行 / 展示 / 上传日期，和商业平台日期不一定相同。

## 核对结果与边界

本轮保留原有 139 个曲目 ID，新加入 31 个作品 / 版本：组合 Apple 目录新增 20 个、组合官方视频伴奏新增 9 个、《海奏ララバイ》主唱与伴奏新增 2 个。因此既有链接、收藏与数据库票数仍使用原键。

| 核对对象                  | 本轮可核对结果                                                                    | 收录处理                                                 |
| ------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| ナナツカゼ Apple 目录     | 27 个版本：23 首主唱、4 首伴奏                                                    | 完整展开已发现发行，与既有 7 个组合记录合并              |
| ナナツカゼ官方频道 Videos | 两页共 33 条公开视频：22 条主唱、9 条完整伴奏、1 条串烧、1 条 56 秒 acoustic 片段 | 补入 Apple 没有的 9 个完整伴奏；串烧与片段不计为完整歌曲 |
| ナナツカゼ合并目录        | 36 个版本：23 首主唱、13 首伴奏                                                   | 保留组合署名、日英别名与版本区分                         |
| 《海奏ララバイ》          | 2026-09-23 发行的主唱与伴奏版                                                     | 按官方制作署名纳入，保留初星学園、秦谷美鈴的演唱署名     |

这里的“完整”限于此次可访问的公开目录和频道 Videos 页面，不包括已经删除、私密、地区不可见、未发行或仅存在于 Shorts 等其他位置的内容。部分官方视频描述还链接外部伴奏资源，本次没有下载或核验这些文件，因此不能据此保证收齐所有历史伴奏。没有用搜索结果数量或艺人页显示总数代替逐曲核对。

- 主艺人歌曲查询在美区返回 131 首，在日区返回 132 首。搜索与发行展开进一步发现漏在主目录以外的署名版本。
- 补充记录包括《After Rain》（游戏 OST，2026-10-07）、《Summer Rain (PIKASONIC Remix)》、《Are You Still There (PIKASONIC Remix)》和《Sakura (feat. Kimura Rin) [Pikasonic Remix] [Mixed]》。混音不能仅靠主艺人作品列表找全。
- 搜索中的《Best Buddies (PikaSonic)》由 BrainRot Media Ava 署名，与本项目艺人无关。脚本不会仅因普通歌名中含有 “PikaSonic” 就接纳记录。
- 《2016-2017》在 Apple 平台上的发行日为 2026-08-15；此日期表示当前发行记录，不表示音乐一定创作于 2026 年。标题和平台元数据按来源原样保留。
- 《8BLUE》在合辑和单曲重复收录，合并后保留两个来源；其他单曲 / 合辑重复也保留在 `releases`。
- ナナツカゼ作为经官方身份核实的独立组合目录收录，包括仅署名组合名的公开发行。既有组合曲目与新发现记录按标题、完整版本及近似时长合并，保留原始平台署名和来源。不得将所有组合歌曲改写为 PIKASONIC 个人发行。
- 《海奏ララバイ》依据官方制作署名纳入，2026-09-23 发行的主唱与伴奏版分别收录。网易云主唱版为 [3436810769](https://music.163.com/#/song?id=3436810769)，其艺人元数据也含 PIKASONIC；未核实的伴奏网易云入口保持搜索。
- 《Sakura rain》与《ららら》是同一发行的不同平台文字：组合[官方发行链接](https://linkco.re/HVQpr3Mr)的 Apple 按钮指向发行 `1803336372`、曲目 `1803336625`。合并为一首并保留别名，不因标题语言不同重复增加数量。
- SoundCloud 官方用户 ID 为 294273258，其资料页计数为 108 首上传，但当前访客曲目接口仅返回 79 首且下一页为空。已把这 79 首全部核对并保留，不能把资料页计数误称为可访问或已收录数量。
- SoundCloud 新补回《Climax》《Good Morning And Diamond 60s》《Rese》，将早期可验证作品延伸至 2017 年。《Climax》原页面类型为 Bass house，《Good Morning And Diamond 60s》为 Melodic Drumstep。
- PIKASONIC 官方 YouTube 频道核对了首屏和 Uploads 播放列表的 100 条视频；续页接口未返回更多条目。新增《Space Walk (PIKASONIC Remix)》《Liyue Battle BGM (PIKASONIC Remix)》、游戏短版《Skyfall [CHRONO CIRCLE]》以及独立完整的《Sakura (ft.Kimura Rin) [PIKASONIC Remix]》。完整 Sakura 混音与 Apple 的 `[Mixed]` DJ 版时长明显不同，分开保留。普通官方 MV、Performance Video、预告和混音合集没有重复计作新歌曲。
- 官方公开链接可见于 MusicBrainz 关系。Bandcamp 的音乐页此次没有展示发行列表；旧主页链接 `pikasonicmusic.com` 未能访问，未采用其内容。未经核实的 `pikasonic.com` 域名不作为官网来源。
- YouTube、SoundCloud、Bandcamp 独占、未发行、已下架、游戏内独占和不同地区不可见的作品可能缺失。Apple 的艺术家归属也可能发生错误；保留来源与同名艺人标记有助于纠错。

此前已抽样请求 8 张代表封面的 600 × 600 URL，均返回 HTTP 200，包括 Reflect、8BLUE、Haruka、Infinity、Nostalgia、Lockdown 和 Dreamland。目录检查要求曲名、艺人、来源与封面链接非空；无法核实的逐曲流派与独立视频发行日期保留空值，交由页面明确显示待核实，不能为通过检查而推测填写。

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
