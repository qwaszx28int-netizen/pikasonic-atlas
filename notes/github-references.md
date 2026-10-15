# GitHub 同类项目调研

核查日期：2026-10-15（北京时间）。通过 GitHub 公开 REST API 实际读取仓库元数据与 README，未下载项目代码、截图、封面或其他资产。Star 数为查询时快照，不代表质量保证；以下借鉴点是基于公开文档的功能与组织方式观察，未运行其应用。

## 已核查的主要参考

| 项目                                                          | Star 快照 | GitHub 识别的许可 | 维护与时间信息                                                                              |
| ------------------------------------------------------------- | --------: | ----------------- | ------------------------------------------------------------------------------------------- |
| [SPlayer-Dev/SPlayer](https://github.com/SPlayer-Dev/SPlayer) |     7,381 | AGPL-3.0          | API 标记 archived；README 写明维护模式。默认分支最近提交：2026-06-10 03:56:42 UTC。         |
| [navidrome/navidrome](https://github.com/navidrome/navidrome) |    24,169 | GPL-3.0           | API 标记未归档。最近推送：2026-10-14 14:23:29 UTC；提交接口超时，未把推送时间当作提交时间。 |
| [metowolf/MetingJS](https://github.com/metowolf/MetingJS)     |     1,409 | MIT               | API 标记未归档。最近推送：2026-04-12 14:21:48 UTC；提交接口超时，最新提交日期未核实。       |

### SPlayer：音乐资料的浏览与偏好

实际读取：[README](https://github.com/SPlayer-Dev/SPlayer#readme)、[仓库 API](https://api.github.com/repos/SPlayer-Dev/SPlayer)、[已核查的最近提交](https://github.com/SPlayer-Dev/SPlayer/commit/40d9ec606cc1e323c964ffea7bf0ab02f137e93b)。旧地址 `imsyy/SPlayer` 的 API 返回当前仓库 `SPlayer-Dev/SPlayer`。

可借鉴的三点：

1. README 将音乐管理分类、歌单、收藏歌手等用户任务列得清楚，提示资料站也应围绕“找歌曲—辨认版本—保存喜欢的作品”组织导航。
2. 明确提供 Light / Dark / Auto 和封面主题色等外观选项，说明偏好设置可以成为完整体验的一部分。
3. README 对网页、桌面、依赖服务和部署方式分别说明，贡献者容易判断运行条件；同时清晰告知已进入维护模式。

本项目的独立实现建议：自行编写 React 曲目卡片与列表；用本地收藏和封面展示偏好满足资料浏览；README 明确静态部署与数据同步的不同步骤。SPlayer 的播放器、账户、歌词、云盘与音频功能涉及不同目标，本项目保留正版平台链接的导听流程。

### Navidrome：曲目、专辑与元数据的关系

实际读取：[README](https://github.com/navidrome/navidrome#readme)、[仓库 API](https://api.github.com/repos/navidrome/navidrome)。其 README 定位为自托管音乐收藏服务，并明确列出元数据、合辑、多碟专辑、收藏和响应式 Web 界面。

可借鉴的三点：

1. 将曲目元数据作为音乐库基础，合辑和多碟专辑作为明确情况处理，提醒资料站不能仅靠歌名认定重复。
2. 同时面向大量音乐收藏与响应式浏览，适合参考其按歌曲、专辑组织信息的产品思路。
3. README 清楚区分开发分支与稳定发行，并链接安装、开发、翻译和 API 文档，降低后续维护成本。

本项目的独立实现建议：为曲目保留稳定 ID、来源、发行记录与别名；重复发行合并时保留可追溯记录；专辑视图与歌曲视图共用同一数据源；以渐进展示、检索和移动端布局控制大目录的浏览负担。

### MetingJS：多来源信息与配置

实际读取：[README](https://github.com/metowolf/MetingJS#readme)、[仓库 API](https://api.github.com/repos/metowolf/MetingJS)。README 说明其依赖 APlayer，列出 `server`、`type`、`id`、自定义 API、封面、列表折叠、列表高度和 `storage-name` 等参数。

可借鉴的三点：

1. 用明确的来源、内容类型和标识符表达音乐条目，适合启发本项目将来源信息放进数据模型。
2. 配置项有默认值与说明，便于使用者理解设置，适合用于本站封面开关、排序和收藏等偏好。
3. README 明确元素配置、全局配置、默认配置的优先顺序，可借鉴为人工修正、同步数据和界面默认值之间的清晰规则。

本项目的独立实现建议：自己实现 `sourceName` / `sourceUrl` 与 HTTPS 链接校验；外链按钮显示真实平台；以项目专用 localStorage 键存储偏好；人工补充和排除列表应优先于自动同步结果。README 列出的平台不代表其接口在本次核查中均已验证可用。

## 额外核查的历史项目

[Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 的公开 API 返回 30,240 Stars、archived 为 true，最近推送为 2024-02-28 02:47:42 UTC。当前 [README](https://github.com/Binaryify/NeteaseCloudMusicApi#readme) 只有“保护版权，此仓库不再维护”和相关新闻链接；API 没有返回可确认的 SPDX 许可，故不推断当前代码的许可或可用性，也不将其作为本站运行依赖。

从该现状得到的实施建议是：明确维护状态；让数据来源具备可替换的适配层；保存静态目录使第三方接口变化不会令网站立即失去浏览能力。这是本项目的设计建议，不是对其历史接口功能的测试结论。

曾尝试读取 `qier222/YesPlayMusic` 元数据与 README，但本次网络请求持续超时，未将其未经核实的功能、Star 或许可写入参考结论。

## 本项目采用的边界

参考公开文档中的信息组织与交互任务，React、样式、数据转换和测试自行实现。没有从这些仓库复制代码、UI 资源、截图或音乐资产。

本站的 MIT 许可仅覆盖本站原创代码和配套文档。SPlayer 的 AGPL-3.0、Navidrome 的 GPL-3.0 以及任何第三方依赖的许可都保持各自效力，不能通过放入本仓库而改标 MIT。即使参考项目采用 MIT，若以后实际复用其代码，仍需单独核对并保留要求的许可和版权声明。

音乐、封面、歌词与平台数据的权利独立于代码许可。调研未授予任何音乐或封面使用权，也未证明“非营利”可免除版权责任；具体说明见 [内容与版权政策](../CONTENT_POLICY.md)。
