# PIKASONIC 曲目档案

一个非官方、非营利的 PIKASONIC 中文歌曲资料与导听网站。目前目录整理了 **139 首作品**，合并 Apple Music 公开发行资料，并补充官方 SoundCloud、YouTube 可核对的独立作品与不同版本。这个数字是当前快照，不是“全球全部歌曲”的证明。

[源码仓库](https://github.com/qwaszx28int-netizen/pikasonic-atlas) · [问题与建议](https://github.com/qwaszx28int-netizen/pikasonic-atlas/issues)

> 本项目与 PIKASONIC、唱片公司及音乐平台不存在官方关联。“非营利”声明不构成版权许可，也不能保证免除版权责任。代码采用 MIT 许可；歌曲、封面、艺术家名称及相关商标等权利仍归各自权利人所有。

## 功能

- 浅紫、樱粉与天空蓝的二次元主题；主页使用真实封面构成三列交错流动曲绘墙，支持暂停、点击导听与减少动态偏好。
- 七个功能页面使用公开来源的真实发行曲绘作为不同主题的横幅背景，遮罩保障文字辨识，点击曲绘署名可查看对应歌曲详情或发行来源。封面展示开关同时控制背景，图片加载失败时使用渐变兜底；曲绘版权归原权利人所有。
- 搜索曲名、艺人、发行名称及多语言别名，按年份、合作 / 混音类型、曲风筛选。
- 默认按网易云艺人热歌列表的已匹配快照顺序浏览，也可切换日期或标题排序；快照顺序不代表播放量。
- 按年份浏览「音乐历程」，整理已收录作品的公开年份，不将它表述为未经验证的完整创作历史。
- 从当前搜索 / 筛选 / 收藏结果随机发现一首作品；歌曲详情支持复制分享链接，让他人直接打开对应的歌曲导听。
- 每首提供曲风信息、发行资料、中文导听与来源；优先显示可信平台的细分风格，未知项明确标为待核实。
- 每首提供网易云音乐与 YouTube 入口：已核对的记录直接跳转，未核对的明确标为平台内搜索。
- 按需展示来自外部来源的封面，并提供纯文字浏览选项。
- 在当前浏览器收藏曲目，收藏信息保存于 `localStorage`。
- 通过真实 SQLite 后端共享投票，可投票、撤票并查看 Top 10。
- 支持公开目录同步、人工校正与 GitHub Actions 静态部署。

热门排序、音乐历程、随机发现与分享链接的使用及数据边界见 [发现作品与音乐历程](docs/discovery-and-history.md)。网易云热歌排序来自外部目录快照，与本站 SQLite 共享投票的 Top 10 分开计算。

## 本地运行

推荐 **Node.js 24**，最低 **Node.js 22.18**，使用 npm 安装依赖。

```bash
git clone https://github.com/qwaszx28int-netizen/pikasonic-atlas.git
cd pikasonic-atlas
npm install
npm run dev
```

开发脚本同时启动后端 `3001` 与 Vite `5173`；访问 [本地网站](http://127.0.0.1:5173)。Vite 将 `/api` 转发至后端。

```bash
npm test
npm run build
npm start
```

`npm test` 包含目录、检索、平台入口和共享投票等自动测试。生产构建输出到 `dist/`；`npm start` 默认在 [端口 3001](http://127.0.0.1:3001) 同时提供静态网站与 API。`npm run preview` 只预览静态构建，不提供投票后端。

需要自定义仓库入口时，复制 `.env.example` 为 `.env`，将 `VITE_REPOSITORY_URL` 设为实际维护的 GitHub 仓库地址；分叉部署时请使用自己的仓库，网站的项目与 Issues 入口将使用这个地址。`VITE_` 变量会进入前端构建，不能存放密钥。生产服务环境变量请按部署文档配置。

## 投票与完整部署

每个浏览器身份对每首歌最多一票，可以撤回；相同 API 的用户看到同一份票数，Top 10 只列有票作品。身份通过带签名的 HttpOnly Cookie 中的随机 ID 识别，**不是按真实人物去重**。清除 Cookie、更换浏览器、设备或隐私模式可能获得新身份。

投票身份不收集姓名、邮箱等直接身份资料；服务会处理请求 IP 进行限频。票数、随机身份记录及签名密钥保存在 SQLite，数据库不得上传到 GitHub。完整功能需要运行 Node.js 的主机或 Docker，并为数据库配置可写持久目录；更新程序时保留数据库。

GitHub Pages 只支持静态目录与导听，不能运行 SQLite 后端或提供共享投票。没有 API 时，页面会提示投票服务不可用。完整的 Node、Docker、HTTPS、持久卷与备份配置见 [共享投票与部署](notes/voting-deployment.md)。

## 目录覆盖与更新

本项目以可公开查询的音乐目录为基础，尽可能收录 PIKASONIC 的作品。目录可能受到平台地区、艺人归属、版本差异、下架情况和接口限制影响；不能据此承诺覆盖世界范围的全部作品。合作曲、别名发行、重混、不同地区发行和未在数据来源上线的作品，尤其需要人工核查。

补充独立上传元数据，并与现有 Apple 目录合并：

```bash
npm run sync:independent
npm run sync:catalog -- --merge-independent
node scripts/sync-independent.mjs --youtube-from-snapshot
npm run sync:netease
```

如需完整刷新 Apple 目录，先执行 `npm run sync:catalog`，再执行上述补充与合并步骤。`sync:independent` 同时整理官方 YouTube 信息与链接映射；`sync:netease` 更新网易云精确匹配与艺人热歌列表快照，未匹配项继续使用明确标注的搜索链接。热歌排序是该次平台列表的顺序，不是实时播放量或本站票数。

运行后请检查变更，确认艺人身份、曲目与专辑归属、重复版本、曲风依据、封面和平台入口，再执行 `npm test` 与 `npm run build`。目录同步需要网络，第三方服务可能限流、下架或改变结果。上传日期不一定等于首次发行日期，未知日期与曲风应保留待核实状态。

发现缺失或错误时，请在网站对应维护者的 GitHub 仓库中新建 Issue，附上歌曲名称和艺术家、厂牌或音乐平台的公开链接；也可提交 Pull Request。请保留数据来源，不以搜索结果数量作为“全部收录”的证明。

导听介绍是便于理解和发现作品的编辑内容。涉及创作背景、发行经过、合作关系等事实时必须引用可核查的来源；未经核实的内容不应当作事实发布。

## 开源、贡献与 GitHub Pages

欢迎 Fork 仓库、补充有来源的曲目资料或提交功能修复。贡献代码时在自己的分叉仓库创建分支，执行测试和构建后提交 Pull Request；具体要求见 [贡献指南](CONTRIBUTING.md)。提交前确认没有包含数据库、令牌或 `.env`。

GitHub Pages 需单独启用；以下是静态部署方法，不表示站点已经上线。在自己的仓库 **Settings → Pages → Build and deployment** 中将 **Source** 设为 **GitHub Actions**，再运行提供的 Pages 工作流。成功后可在该设置页查看静态站点地址。Vite 基础路径为 `./`，适配项目仓库路径。

若默认分支不同，请调整工作流监听分支。所附 Actions 工作流会自动将当前 GitHub 仓库地址传入 `VITE_REPOSITORY_URL`；其他构建方式需自行配置并验证。上述步骤完成后，以实际仓库与部署状态为准。需要共享投票时，改用前述完整部署。

## 内容与版权

本站不播放或托管歌曲音频、音乐视频或完整歌词，不提供下载或绕过音乐平台限制的功能。收听入口指向第三方平台；搜索结果不等于经过核实的歌曲直达页，平台可用性、登录要求及地区限制由其决定。

封面由外部来源远程提供，仅在用户选择展示时加载；远程引用不意味着已经获得授权。若无法确认封面使用依据，可以使用纯文字模式或移除对应封面链接。

权利人可通过部署者所属仓库的 GitHub Issues 提交移除或更正请求，说明涉及的页面、作品及权利依据。维护者应及时核查，并视情况先行隐藏争议内容。请勿在公开 Issue 中上传身份证明、联系方式等敏感资料。

完整说明见 [内容与版权政策](CONTENT_POLICY.md)，贡献规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 参考与许可

使用 React、Vite、TypeScript、Node.js 与 SQLite。参考 [SPlayer](https://github.com/SPlayer-Dev/SPlayer)、[Navidrome](https://github.com/navidrome/navidrome)、[MetingJS](https://github.com/metowolf/MetingJS) 的公开文档，借鉴信息组织与配置思路，未复制其代码、截图或资产。调研依据与许可差异见 [GitHub 同类项目调研](notes/github-references.md)。

项目代码采用 [MIT License](LICENSE)。该许可不授予歌曲、封面、歌词、音乐录音、名称或商标的使用权，也不覆盖第三方平台的数据条款。重新部署或分发本项目时，请自行核查所使用内容的许可与来源要求。
