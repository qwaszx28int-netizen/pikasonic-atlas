# 共享投票与部署

共享投票支持 Cloudflare Workers + D1，以及 Node.js / Docker + SQLite 两种部署。网站卡片从真实接口读取票数，排行榜展示得票最高的前 10 首作品；没有投票的作品不会占用排行榜位置。

[Netlify 主站](https://pikasonic-atlas.netlify.app/) 提供免费页面与同源函数代理，浏览器不必直连 `workers.dev`；代理继续使用原 Cloudflare Worker 和 D1，共享历史票数。正式发布使用 Free 套餐，额度用尽会暂停服务，大陆连通性需按运营商实测。配置与限制见 [Netlify 免费部署](../docs/netlify-deployment.md)。

Cloudflare [备用入口与数据后端](https://pikasonic-atlas.pikasonic-atlas.workers.dev) 同源提供页面和 API，票数持久保存在远端 D1。签名密钥默认自动生成并保存在 D1 `meta` 表中，可选 `VISITOR_SECRET`。自行部署时，用户注册并通过 Wrangler 授权，不需向聊天提供账号凭证。完整步骤、迁移命令与免费额度见 [Cloudflare 部署指南](../docs/cloudflare-deployment.md)。

以下主要介绍原有 **Node.js / Docker + SQLite** 方案。它需要支持内置 `node:sqlite` 的 Node.js 22.18+ 或 Node.js 24，推荐 Node.js 24。两种部署不会自动同步数据库；从本地 SQLite 切换到 D1 时，历史票数需另行迁移。

## 本地开发

```sh
npm ci
npm run dev
```

开发脚本同时启动端口 3001 的后端和端口 5173 的 Vite，Vite 将 `/api` 转发到后端。浏览器访问 `http://127.0.0.1:5173`。脚本退出时会清理自己启动的进程。

## 普通服务器

```sh
npm ci
npm run build
```

随后设置环境变量，并启动 `node server/index.mjs` 或 `npm start`。Node 服务同时提供 `dist` 静态网站与 `/api` 接口；应通过同一个网站域名访问两者。

| 变量             | 默认值                 | 用途                                                               |
| ---------------- | ---------------------- | ------------------------------------------------------------------ |
| `PORT`           | `3001`                 | HTTP 监听端口                                                      |
| `HOST`           | `0.0.0.0`              | 监听地址                                                           |
| `NODE_ENV`       | 无                     | 生产部署设置为 `production`                                        |
| `DATABASE_PATH`  | `data/votes.sqlite`    | SQLite 文件路径；相对路径以进程工作目录为基准                      |
| `SITE_ORIGIN`    | 未设置                 | 生产网站的完整源，例如 `https://music.example.com`，不包含路径     |
| `VISITOR_SECRET` | 数据库中自动生成并保存 | 可选的签名密钥，至少 32 个字符；多实例需要使用相同密钥和同一数据库 |
| `TRUST_PROXY`    | 未设置                 | 仅在入口反向代理覆盖 `X-Real-IP` 且应用端口不对外开放时设为 `1`    |

生产环境建议使用 HTTPS 反向代理，将网站及 `/api` 一起代理到端口 3001，并把 `SITE_ORIGIN` 设置为用户实际访问的 HTTPS 域名。配置该变量后，写操作只接受这个源；HTTPS 配置会令访客 Cookie 带上 `Secure` 属性。不要把开发端口 5173 当作正式服务。

SQLite 文件及其 `-wal`、`-shm` 辅助文件应位于同一可写持久目录中。重启服务器或更新程序时保留整个数据目录；不要把它放在临时文件系统或上传到公开 GitHub 仓库。备份时优先停止服务后复制整个目录，或使用 SQLite 的在线备份机制。

## Docker

```sh
docker build -t pikasonic-atlas .
docker volume create pikasonic-votes
docker run -d --name pikasonic-atlas --restart unless-stopped -p 3001:3001 -e SITE_ORIGIN=https://music.example.com -v pikasonic-votes:/app/data pikasonic-atlas
```

镜像使用 Node.js 24，构建前端后由 Node 提供页面和接口。`/app/data` 是数据库卷挂载点。反向代理需把 `https://music.example.com` 指向这台服务；域名应替换为实际部署地址。仅在本机通过 HTTP 检查时可暂不设置 `SITE_ORIGIN`，以同源方式访问 `http://localhost:3001`，避免 HTTPS `Secure` Cookie 与本地 HTTP 不匹配。

仓库也提供 `compose.yaml` 与 `deploy/Caddyfile`。已有 Linux 服务器和域名时，复制 `deploy/server.env.example` 为 `deploy/server.env`，将 `SITE_DOMAIN` 改为已解析到服务器的域名，开放 80/443 后运行 `docker compose --env-file deploy/server.env up -d --build`。Caddy 自动配置 HTTPS，应用端口仅在私有容器网络可见，`votes` 卷持久保存投票。更新时保留卷，不要用 `down -v`。这套自托管配置需要自行准备主机，不是当前免费的 Netlify 路线。D1 到新 SQLite 的离线转换见 [投票迁移说明](../docs/vote-migration.md)。

SQLite 适合这个项目的单实例部署。若扩展为多台主机或多实例，不应给各实例使用独立数据库后宣称票数共享；需要重新设计数据库部署与并发访问方案。

## 访客身份与规则

后端为浏览器生成随机身份，通过带签名的 `HttpOnly`、`SameSite=Lax` Cookie 保存。数据库的唯一约束确保同一浏览器身份对同一首歌只计一票；重复提交幂等，撤票同样幂等。票数及 Cookie 签名密钥保存在数据库中，因此重启后仍可识别原浏览器的投票。

这是一种浏览器身份限制，**不是真人身份去重**。清除 Cookie、更换浏览器、使用隐私模式或设备都可能获得新身份并再次投票。基础 IP 速率限制可抑制过快的重复请求，但不能保证阻止所有刷票。如果用于正式评选或奖励活动，需要额外的账户和反滥用机制。

`totalVoters` 表示当前至少有一票的不同浏览器身份数量；全部撤票后该身份不计入这个数。它不代表真实参与人数。修改 `VISITOR_SECRET` 或丢失数据库中的自动密钥会使既有 Cookie 失效；投票记录仍保留，但原浏览器可能无法撤回旧票。

## 接口

所有接口返回 JSON，错误返回 `{ "error": "错误信息" }`。浏览器通过同源请求自动携带 Cookie，不应自行传入访客 ID。

- `GET /api/leaderboard`：`{ entries: [{ trackId, votes }], counts: { [trackId]: votes }, totalVotes, totalVoters }`。`entries` 是前 10 名；`counts` 含所有已获票作品，零票作品可省略。
- `GET /api/votes`：`{ votedTrackIds: [trackId] }`，返回当前浏览器已投票的歌曲。
- `POST /api/votes/:id`：投票，返回 `{ votes, voted: true }`。
- `DELETE /api/votes/:id`：撤票，返回 `{ votes, voted: false }`。

写请求校验 `Origin`，只允许目录中的作品，限制请求体大小与请求频率。接口不提供公开跨域访问；前端与后端不同部署时应配置同源反向代理，而非在浏览器里直接指向另一个域名。

## GitHub Pages 的限制

GitHub Pages 只能提供静态文件，无法运行 Node.js 服务或持久化共享 SQLite 投票库。直接把 `dist` 发布到 Pages 可以展示歌曲目录与导听内容，**不能由 Pages 提供共享投票和排行榜**。没有可用 API 时，前端应明确显示投票服务不可用，不使用浏览器本地数据伪装共享票数。

现有 [Pages 地址](https://qwaszx28int-netizen.github.io/pikasonic-atlas/) 是静态预览，并会自动显示上述 Netlify 主站的跳转入口。分叉仓库的静态构建可设置 `VITE_FULL_SITE_URL`，指向自己部署的完整版地址。该变量不提供跨域 API 连接；完整版构建时将它留空。

若需要完整投票功能，可选择 [Cloudflare Workers + D1](../docs/cloudflare-deployment.md)，或使用可运行 Node.js 且有持久磁盘的主机、容器平台或 VPS，按上述方式同源部署页面与 API。若另用静态托管，需要在同一站点源下通过网关或反向代理接入后端；仅创建 GitHub Pages 仓库不会自动完成这项配置。
