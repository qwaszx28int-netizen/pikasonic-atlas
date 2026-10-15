# Cloudflare Workers + D1 完整部署

这套方案在同一个 Cloudflare Workers 站点下提供前端静态文件与 `/api`，通过远端 D1 数据库持久保存共享投票。它包含投票、撤票和 Top 10，区别于只提供静态浏览的 GitHub Pages。原有 Node.js / Docker + SQLite 方案仍可使用，见 [共享投票与部署](../notes/voting-deployment.md)。

[Cloudflare 备用入口](https://pikasonic-atlas.pikasonic-atlas.workers.dev) 已完成 Workers 部署与远端 D1 迁移；[Netlify 主站](https://pikasonic-atlas.netlify.app/) 通过同源函数使用这个投票后端，浏览器无需直接访问 `workers.dev`。免费入口的网络及额度限制见 [Netlify 部署](netlify-deployment.md)。[GitHub Pages 地址](https://qwaszx28int-netizen.github.io/pikasonic-atlas/) 保留为静态预览。下面的步骤供自行部署使用，成功后以 Wrangler 返回的自己站点地址访问完整功能。

## 准备账号与项目

需要 Node.js 24（最低 22.18）、npm，以及用户自行注册的 Cloudflare 账号。Wrangler 已作为项目开发依赖提供，无需全局安装。

用户应在 Cloudflare 官方页面完成注册，并在 Wrangler 打开的浏览器中自行登录和授权。无需把账号密码、验证码、API Token 或其他凭证发送到聊天或提交到 GitHub。

```sh
git clone https://github.com/qwaszx28int-netizen/pikasonic-atlas.git
cd pikasonic-atlas
npm install
npm run build
npm run cf:login
```

`cf:login` 执行 `wrangler login`，会打开 Cloudflare 的授权页面。`account_id` 通常可由 Wrangler 根据登录账号解析；若账号可访问多个 Cloudflare 账户，请按提示选择正确账户。

## 创建远端 D1 并部署

```sh
npm run cf:db:create
```

该命令执行 `wrangler d1 create pikasonic-atlas-votes`。自行部署时，把自己账户返回的 `database_id` 填入 `wrangler.jsonc` 已有的 D1 绑定配置，替换仓库中的数据库 ID，并保留数据库名称和 `DB` 绑定名称。仓库已有 ID 属于原站，不能替代自己账户的数据库。

随后初始化**远端**数据库并发布：

```sh
npm run cf:db:migrate
npm run cf:deploy
```

`cf:db:migrate` 执行 `wrangler d1 migrations apply pikasonic-atlas-votes --remote`。`cf:deploy` 执行 `npm run build && wrangler deploy`，把构建后的前端与 API 一起部署。若 Cloudflare 要求设置 Workers 子域名，请在自己的账户中按提示完成；最终访问地址以部署输出为准。

发布后在输出的 `workers.dev` 地址检查歌曲目录、搜索、投票、撤票与排行榜。两个浏览器访问同一个 Worker，应看到同一套 D1 票数；同一浏览器身份对每首最多一票。这不是真人身份去重，更换浏览器、设备或清除 Cookie 可能获得新身份。

不要把 GitHub Pages 页面直接连接到另一个域名的投票 API；本项目采用同源 Cookie 与来源校验，应从完整 Worker 站点使用页面和 `/api`。

## 静态预览的完整版入口

原站 GitHub Pages 地址会自动显示前往上述完整版的入口。分叉项目的静态站可在构建时设置 `VITE_FULL_SITE_URL`，指向自己部署的完整版，例如：

```dotenv
VITE_FULL_SITE_URL=https://pikasonic-atlas.pikasonic-atlas.workers.dev
```

该变量只是跳转目标，不是跨域 API 配置。分叉仓库需在自己的静态构建环境或工作流中配置自己的完整版地址；原站的地址识别不会替分叉项目指定目标。Worker 或 Node.js 同源完整版构建时保持 `VITE_FULL_SITE_URL` 为空，让当前站点直接使用自己的 `/api`。这是构建期变量，修改后需重新构建并发布。

## 持久数据与签名密钥

投票与随机浏览器身份保存在远端 D1 中，正常重新部署 Worker 不会重置该数据库。后端默认自动生成 HMAC 签名密钥并保存在 D1 的 `meta` 表中，因此无需为首次部署手工准备密钥；使用同一数据库和密钥时，重启或部署后仍可识别既有 Cookie。

如需自行管理密钥，可通过 Wrangler 的 secret 功能设置可选的 `VISITOR_SECRET`：

```sh
npx wrangler secret put VISITOR_SECRET
```

在终端交互中输入至少 32 个字符的高熵随机密钥，不把它放进前端 `VITE_` 变量或公开配置。修改密钥、切换数据库或删除 `meta` 中的自动密钥，可能令旧 Cookie 失效，使原浏览器无法撤回旧身份的票。

Node.js 本地 SQLite、Wrangler 本地 D1 与 Cloudflare 远端 D1 是不同数据库，票数不会自动互相同步。迁移旧投票需要另行核对和导入，不能仅更换部署地址就宣称历史票数已经迁移。访问域名改变后，浏览器收藏及 Cookie 也不会自动跨域转移。

生产数据不应导出到公开 GitHub 仓库。更新前确认绑定的是正确数据库；涉及删除、重建或数据迁移时先准备可恢复备份。

## 本地模拟 Cloudflare

```sh
npm run cf:db:migrate:local
npm run cf:dev
```

本地迁移只初始化 Wrangler 的本地 D1，不会替代 `--remote` 的生产迁移。`cf:dev` 先构建前端，再执行 `wrangler dev --local`；访问终端给出的本地地址。`.wrangler` 中的本地状态与密钥不要提交到仓库。

原有 `npm run dev` 仍启动 Vite + Node.js 后端；`npm start` 仍用于 Node.js 生产部署，二者不表示正在使用远端 D1。

## 免费额度与使用边界

截至 2026-10-15 核对的 Cloudflare 官方免费额度如下；套餐和限制可能变化，以账号实际设置及官方文档为准。

| 项目             | Free 限制         |
| ---------------- | ----------------- |
| Workers 动态请求 | 每日 100,000 次   |
| D1 读取          | 每日 5,000,000 行 |
| D1 写入          | 每日 100,000 行   |
| D1 单库大小      | 500 MB            |
| D1 账户总存储    | 5 GB              |

配额会与账户中的其他应用共享；静态资源请求与执行 Worker 的动态请求计量方式不同。D1 按处理的**行数**计量，不是按投票次数；一次页面加载或投票可能触发多次查询，索引、汇总与元数据操作也可能产生读写。不能把这些数字解释为保证支持同等数量的日访客或投票。

免费不是不限量。超过免费日配额时，相关请求或数据库操作可能失败；不要向访问者承诺无限请求、无限存储或永远可用。是否升级付费套餐由账户持有人自行决定，并应先查看用量与计费设置。

官方资料：[Workers 价格](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 价格](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)。部署方式改变不授予音乐或曲绘版权，内容使用仍遵循 [内容与版权政策](../CONTENT_POLICY.md)。
