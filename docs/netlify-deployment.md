# Netlify 免费备用入口

本方案将网站静态文件和投票代理部署到 Netlify，投票数据继续使用现有 Cloudflare Worker + D1。访客从同一个 Netlify 域名加载网页和访问 `/api/*`，浏览器无需直接连接 `workers.dev` 即可投票。

本站入口：**https://pikasonic-atlas.netlify.app/**。该项目已在维护者的 Free 团队中创建；分叉部署者需使用自己实际创建的项目域名。

Netlify 的免费 `netlify.app` 域名可以持续用于项目，不是一次性预览链接。但是，海外免费托管无法保证中国大陆所有地区、运营商和时段都可直连。部署成功只说明服务已发布，仍需用户用大陆网络关闭代理后实际验证。

## 架构和已有数据

```text
访客浏览器
  └─ Netlify HTTPS 域名
       ├─ dist/ 静态网页、目录和资源
       └─ /api/* → Netlify Function
                    └─ 现有 Cloudflare Worker → 现有 D1 投票数据库
```

函数位于 `netlify/functions/votes.mjs`，只代理以下接口：

| 接口               | 方法         | 用途               |
| ------------------ | ------------ | ------------------ |
| `/api/votes`       | GET          | 当前浏览器投票状态 |
| `/api/leaderboard` | GET          | 共享排行榜和总票数 |
| `/api/votes/:id`   | POST、DELETE | 投票、撤票         |

上游固定为 `https://pikasonic-atlas.pikasonic-atlas.workers.dev`，请求参数和浏览器请求头都不能选择其它目标。原 Worker 和 D1 保留，已有歌曲 ID、历史票数和排行榜继续共享；本方案不复制或清空数据库。

访客身份使用签名的 `HttpOnly` Cookie。Cookie 由各自域名保存，因此同一个浏览器访问 Worker 域名与 Netlify 域名时，个人“我投过的歌曲”状态不会自动跨域同步；两边的总票数仍来自同一个数据库。这不是账号登录或跨设备身份同步。

## 免费额度

根据 [Netlify 官方价格页](https://www.netlify.com/pricing/) 核对的信用点计费方案：

| 项目      | 官方价格或消耗         |
| --------- | ---------------------- |
| Free 套餐 | $0，每月 300 credits   |
| 生产部署  | 每次 15 credits        |
| 计算用量  | 每 GB-hour 10 credits  |
| 带宽      | 每 GB 20 credits       |
| Web 请求  | 每 10,000 次 2 credits |

上述用量共同消耗月度额度，并不是每个项目分别附送 300 点。请求包括网页、静态资源和函数调用；计算与带宽也可能同时计费。Free 有不可超出的月度硬上限，达到上限会影响项目可用性，不能据此承诺无限流量或全年不间断服务。保持 Free 套餐，不升级付费方案；正式部署前先完成本地测试，减少重复生产部署。

Cloudflare Worker 和 D1 仍受它们各自的免费额度限制，Netlify 免费额度不会替代上游额度。价格、配额和条款可能变化，部署和维护时应再核对官方页面。

## 配置服务端代理密钥

两端必须配置相同的服务端环境变量 `VOTING_PROXY_SECRET`，使用至少 32 个字符的随机密钥。推荐随机生成 base64url 字符串；当前函数接受不含空格或换行的可打印 ASCII 字符。密钥不应写入 Git、`netlify.toml`、前端文件或任何 `VITE_*` 变量。

1. 在 Cloudflare Worker 配置中添加或更新 `VOTING_PROXY_SECRET`。也可以使用 Wrangler 的交互输入：

   ```sh
   npm exec --package=wrangler -- wrangler secret put VOTING_PROXY_SECRET
   ```

2. 在 Netlify 项目的环境变量设置中添加同名变量，production 上下文中的值与 Worker 完全相同，并标记为机密。Free 使用默认作用范围即可，不需要为细分 Functions scope 升级付费。不要在终端打印变量值，`env:import` 默认会输出值。设置后重新部署函数。
3. 确认 Worker 已部署验证该代理密钥的代码，再进行正式投票验收。不要改动访客身份的签名密钥；代理密钥和访客签名用途不同。

函数仅从 Netlify 提供的 `context.ip` 读取访客 IP，并验证 IP 格式。只有服务端密钥配置有效时才发送 `X-Pikasonic-Proxy-Secret` 和 `X-Pikasonic-Client-IP`；Worker 验证密钥后才使用该 IP 限流。浏览器伪造的同名请求头不会被转发。

未配置代理密钥时，函数仍可转发投票，但上游按 Netlify 出站 IP 计数，多个访客可能共同触发限流，因此正式使用前应完成两端配置。

写请求必须来自当前 Netlify 域名，函数会校验 `Origin`，再将上游 `Origin` 改为 Worker 的同源地址。请求体限制为 1024 字节，禁止跟随上游重定向，网络请求和响应体读取均有超时。

所有 API 响应，包括错误响应，都设置 `Cache-Control: private, no-store`、`CDN-Cache-Control: no-store` 和 `Netlify-CDN-Cache-Control: no-store`，避免访客投票状态被浏览器或 CDN 缓存。Cookie 原样透传，内部错误和认证头不会作为错误正文返回浏览器。

## 手动部署

仓库已有 `netlify.toml`，构建输出为 `dist`，函数目录为 `netlify/functions`，Node.js 版本为 24。先登录并选择自己的 Netlify 项目，完成两端环境变量配置。

```sh
npm ci
npm test
npm run build
npm exec --package=netlify-cli -- netlify login
npm exec --package=netlify-cli -- netlify link
npm exec --package=netlify-cli -- netlify deploy --prod --no-build
```

如果还没有 Netlify 项目，先通过 Netlify 控制台创建项目，再运行 `netlify link` 关联到该项目。确认部署目标属于自己的账号和 Free 团队。`--no-build` 使用刚完成的本地构建，因此每次修改前端后都必须重新运行 `npm run build`；不要上传过期的 `dist`。

这里采用手动 CLI 发布，不会自动将 GitHub 仓库连接到 Netlify。后续 GitHub 推送不会自动更新这个入口，需要重新构建并执行生产部署。

新团队的项目可能默认仅成员可访问。首次生产部署成功后，在项目主页点击 **Make public**，或在 **Project configuration → General → Visitor access → Project visibility** 将 Production 设为 Public。预览可以保持私有。此设置不需要升级付费；具体规则见 [Project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)。

## 发布后验收

- 确认生产项目已公开，并将 README、静态预览跳转、宣传稿等对外入口更新为实际站点地址。
- 用大陆网络关闭代理访问首页、目录和歌曲详情，确认曲绘与静态资源能加载；在不同网络下分别验证，记录访问条件。
- 查询 `/api/leaderboard`，确认历史票数保留；查询 `/api/votes`，确认返回 JSON 且没有缓存。
- 使用独立测试访客投一票、重复投票、刷新页面，再撤回测试票；确认计票幂等、Cookie 持续有效，并且两个入口的排行榜总数一致。
- 检查 Netlify 和 Cloudflare 的免费额度；达到限额时保留清晰提示，不把旧数据或本地票数伪装成实时联机结果。

官方参考：[Netlify 价格和免费上限](https://www.netlify.com/pricing/)、[函数路由配置](https://docs.netlify.com/build/functions/optional-configuration/)、[函数 API 与 context.ip](https://docs.netlify.com/build/functions/api/)、[Netlify CLI 手动部署](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/)。
