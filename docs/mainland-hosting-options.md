# 中国大陆访问与免费入口

项目已发布并公开 [Netlify 免费入口](https://pikasonic-atlas.netlify.app/)。2026-10-15 在开发电脑上明确绕过代理访问：首页与排行榜接口均返回 HTTP 200，已验证投票、重复投票不加票、撤票、Cookie 持续识别及原站总票数一致，测试票已撤回。这个入口用于改善中国大陆用户的直连体验，**不代表已经完成全国运营商可用性验证**；原 [Cloudflare 入口](https://pikasonic-atlas.pikasonic-atlas.workers.dev/) 继续保留。

当前选择完全免费方案，并接受免费额度和境外线路带来的可用性限制。不购买域名或主机，不启用付费套餐或自动充值。

## 当前方案：Netlify Free + 原有 Worker / D1

Netlify 托管网站静态文件，通过同源 `/api/*` 函数代理访问原有 Cloudflare Worker。浏览器从 Netlify 访问页面和投票接口，无需直接请求 `workers.dev`。投票仍写入同一套 D1，**不迁移数据库，不建立两份独立票数**。

默认的 `pikasonic-atlas.netlify.app` 是生产站点域名，没有 EdgeOne 默认域名的 3 小时预览限制。但它仍是境外服务，官方没有承诺中国大陆各运营商长期稳定；Netlify 到 Worker 的服务端连接也必须实际验证。

Netlify 当前 Free 套餐是每月续期的免费套餐，不是限时试用。每月 **300 credits** 由团队所有项目共享，有硬上限；用尽后站点暂停，等待下一个计费周期重置，不会因超额自动产生费用。当前主要消耗如下：

| 项目                     | 消耗                  |
| ------------------------ | --------------------- |
| 成功的 production deploy | 15 credits / 次       |
| 函数计算                 | 10 credits / GB-hour  |
| 出站流量                 | 20 credits / GB       |
| 网站请求                 | 2 credits / 10,000 次 |

上述额度同时消耗，不能把 300 credits 分别当成每个项目的独立免费额度。减少不必要的正式发布，并在控制台查看实际剩余额度。若额度用尽，当前选择等待免费周期恢复。

### 生产部署后设置公开

2026-07-28 起创建的新团队默认让新项目保持 private。成功上传 production deploy 后，仍须在项目页点 **Make public**，或进入 **Project configuration → General → Visitor access → Project visibility**，将 Production 设为 Public 并保存。Previews 可以继续 private。

发布完成后，应使用未登录 Netlify 的浏览器检查首页与 `/api/leaderboard`，防止把仅自己账号可见的页面当成公开网站。若团队设为 **Private for all projects**，应先调整团队的默认可见性设置。

### 数据与浏览器身份

原有总票数由 D1 保留，新入口的投票与旧入口读取同一个数据库。更换域名后，浏览器投票 Cookie 与本地收藏不会自动跨域迁移，因此同一用户在两个域名下的浏览器身份可能不同。代理必须保留投票接口的 Cookie、禁止缓存个人投票结果，并通过实际投票、撤票测试验证。

## 可选的主机路线

以下是日后愿意承担域名和主机费用时的选项，**当前未购买或迁移**。本项目已有 Node.js 24 + SQLite / Docker 部署能力，操作步骤见 [共享投票与部署](../notes/voting-deployment.md)。

| 路线                               | 需要准备                                                                                  | 适用情况与验证                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 中国大陆主机 + 自有域名 + ICP 备案 | 云平台账号、支持持久磁盘的 Node.js 24 主机或容器主机、自有域名；按接入商要求完成 ICP 备案 | 以大陆访问为主时优先考虑。备案和域名解析完成后部署 Docker，配置 HTTPS，将页面及 `/api` 同源代理到服务。                             |
| 香港主机 + 自有域名                | 云平台账号、支持持久磁盘的香港主机、自有域名                                              | 主机位于香港时通常无需中国大陆 ICP 备案，但香港线路仍涉及跨境网络，不能保证所有大陆运营商稳定。先测试拟用主机线路，再确定长期使用。 |

域名与主机通常有持续费用；本项目没有预先购买，也没有承诺任何套餐价格。应在平台实际订单页核对续费、流量、磁盘和服务期限。使用中国大陆加速节点的 CDN，仍须满足该服务的 ICP 接入要求，不能用香港源站推断大陆 CDN 免备案。

## 其他免费托管的限制

- **普通 Cloudflare Workers / 自定义域名：**绑定自己的域名可改变入口，但不等于启用中国大陆节点。Cloudflare 官方说明，境外网络向大陆提供内容存在延迟及可靠性问题；其 China Network 是 Enterprise 套餐的独立订阅，并要求有效 ICP。不能把免费绑域名说成大陆稳定访问的确定修复。
- **EdgeOne Pages（现名 Makers）：**官方仍提供免费版，但中国大陆网络访问平台默认的项目域名、部署域名时，要使用控制台生成的预览链接；链接有效期仅 **3 小时**，过期返回 401，因此不适合作为长期公开入口。稳定入口需要自定义域名；选择中国大陆或包含中国大陆的全球加速区域时，域名须有 ICP 备案。全球不含中国大陆区域无需 ICP，但也不能据此保证大陆线路稳定。
- **共享投票不能只搬静态文件：**GitHub Pages 或单纯静态镜像不提供本项目的投票数据库。EdgeOne 函数、KV 等能力不等同于现有 SQLite 持久磁盘；若选择该平台，必须另外验证后端及存储方案，不能只发布 `dist` 后宣称共享投票已迁移。

## 验收与日后迁移

1. 完成 Netlify production 发布与 Make public；使用未登录平台的浏览器检查页面和 API，确认接口由函数处理，没有被 SPA 回退页面覆盖。
2. 核对 Netlify 新入口与 Cloudflare 旧入口读取的共享总票数；在两个独立浏览器测试投票、重复提交、撤票和排行榜，确认测试票已撤回。
3. 从**关闭代理的中国大陆电信、联通、移动网络**分别检查首页、曲绘、搜索、投票、撤票与排行榜，记录具体网络、时间与结果。开发电脑返回 HTTP 200、海外探测成功或某一个运营商成功，都不能当作全国访问验证完成。
4. 日后若改用普通主机，先确定域名与线路；大陆主机完成备案，香港主机先实测线路。部署 Node.js 24 / Docker，挂载持久目录，设置实际 HTTPS `SITE_ORIGIN`，页面及 `/api` 同源转发。
5. 只有日后从 D1 迁移到 SQLite 时，才需要备份、导出并核对票数，准备兼容的迁移方案，避免两个独立数据库同时接收投票。当前 Netlify 代理方案不迁移 D1。

## 官方依据

以下资料于 2026-10-15 核对，规则与免费额度以平台最新页面及账号实际配置为准。

- [Netlify：Pricing](https://www.netlify.com/pricing/) 与 [How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)——Free 的 300 credits / 月、各项消耗、硬上限和暂停规则。
- [Netlify：Understand domains](https://docs.netlify.com/manage/domains/domains-fundamentals/understand-domains/)——默认 `netlify.app` 生产站点域名。
- [Netlify：Functions configuration](https://docs.netlify.com/build/functions/configuration/#routing)——同源函数路径与通配路由配置。
- [Netlify：Project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)——新团队默认 private、production deploy 后 Make public，以及生产与预览分别设置公开状态。
- [Alibaba Cloud：What is an ICP filing?](https://www.alibabacloud.com/help/en/icp-filing/product-overview/what-is-an-icp-filing)——说明解析到中国大陆服务器的服务须先备案，并明确 ICP 备案适用于中国大陆服务器。
- [Cloudflare China Network](https://developers.cloudflare.com/china-network/)——境外线路的大陆访问问题、Enterprise 独立订阅及 ICP 条件。
- [EdgeOne：Domain Management / Overview](https://pages.edgeone.ai/document/domain-overview)——大陆访问默认域名的 3 小时预览限制，以及各加速区域的备案要求。
- [EdgeOne：Custom Domain](https://pages.edgeone.ai/document/custom-domain)——大陆或包含大陆加速区域的自定义域名 ICP 条件。
- [EdgeOne：Limits](https://pages.edgeone.ai/document/limits-and-quotas) 与 [Pricing](https://pages.edgeone.ai/document/pricing-and-plans)——免费版当前配额及商业化后可能调整的说明。
