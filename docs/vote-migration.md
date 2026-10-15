# 从 D1 离线迁移共享投票到 Node.js / SQLite

`scripts/import-d1-votes.mjs` 将本项目的完整 Wrangler D1 SQL 导出文件转换为 Node.js 后端可直接使用的 SQLite 数据库。它只导入 `meta.visitor_secret` 和 `votes`，保留浏览器身份、歌曲 ID、原始 `created_at` 毫秒时间戳；排行榜由真实投票行重新计算，不依赖导出中的汇总缓存。歌曲目录仍由仓库中的数据文件提供。

这个工具只做本地离线转换，不连接 Cloudflare、不修改远端 D1，也不会替网站切换流量。迁移数据库本身不能解决大陆访问问题，仍需准备可直连的完整站点托管入口。

## 准备导出

使用 Node.js **24.21 或更新的受支持版本**。工具依赖 Node 内置 `node:sqlite` 和 SQLite authorizer，无需另装数据库驱动。Docker 运行镜像也包含该工具。

先确认 Wrangler 当前账户和数据库绑定属于自己的网站，然后将完整导出保存在仓库忽略的私有备份目录，例如：

```sh
mkdir -p artifacts/backups
npx wrangler d1 export pikasonic-atlas-votes --remote --output artifacts/backups/d1-votes.sql
```

这是读取并下载远端数据库的操作。不要使用 `--no-schema`、`--no-data`，也不要手工拼接多次不同时间的导出。文件含匿名浏览器身份和签名密钥，应当像数据库备份一样保密；不要提交 GitHub、加入公开源码包或粘贴到聊天。该目录已被 Git 忽略，但移动到其他路径时需自行检查。

本工具支持默认存放在 D1 `meta` 表中的密钥。如果原 Worker 配置了 `VISITOR_SECRET` 环境 secret，实际签名密钥会覆盖表内默认值，SQL 导出无法包含该环境 secret。这种情况下还需在新 Node 服务的私有环境中设置**同一个** `VISITOR_SECRET`；否则旧签名无法继续验证。如果 `meta` 内根本没有有效密钥，本工具会拒绝导入，需要另行安排受控的密钥迁移；它不会从 Cloudflare 环境读取或恢复 secret。不要把密钥写进 `VITE_` 变量或公开 compose 文件。

## 转换到新数据库

停止将要使用目标数据库的 Node 服务，然后选择一个**尚不存在**的目标文件：

```sh
node scripts/import-d1-votes.mjs --input artifacts/backups/d1-votes.sql --output data/votes.sqlite
```

成功时只输出总票数、投票浏览器数和有票歌曲数，不输出身份或密钥。导出中不在当前歌曲目录的历史歌曲 ID 也会原样保留。

工具拒绝任何已有的目标文件，包括空文件；也拒绝不匹配的表结构、无有效密钥、重复主键、无效身份或时间戳等情况。不要为通过检查而删除唯一的旧数据库。应先备份旧文件、选另一个文件名完成演练，再安排停机切换。若 Node 服务已抢先启动并生成数据库，应停机后保留该数据库并重新选择目标路径。

转换在目标目录下的私有临时目录中完成，校验票数和完整性后，通过同一文件系统的硬链接一次性发布目标文件。因此文件系统必须支持硬链接（普通本地 Linux 文件系统和 NTFS 支持；某些共享盘、对象存储挂载不支持）。导入失败不会覆盖目标。临时目录正常结束时会清理；若进程被强制终止，应在停机状态下确认并删除残留的 `.vote-import-*` 私有目录。

随后让 Node 后端的 `DATABASE_PATH` 指向导入文件，并保留正常生产环境设置。例如：

```dotenv
DATABASE_PATH=/app/data/votes.sqlite
SITE_ORIGIN=https://your-own-domain.example
NODE_ENV=production
```

如果使用本仓库的 Docker Compose 持久卷，先构建镜像并停止 app，再把私有备份目录只读挂载到一次性容器：

```sh
docker compose --env-file deploy/server.env build app
docker compose --env-file deploy/server.env stop app
docker compose --env-file deploy/server.env run --rm --no-deps -v /absolute/private-backups:/backup:ro app node scripts/import-d1-votes.mjs --input /backup/d1-votes.sql --output /app/data/votes.sqlite
docker compose --env-file deploy/server.env up -d
```

这里 `/absolute/private-backups` 应替换为服务器上的备份目录，并确保容器的 `node` 用户可以读取导出文件、写入持久卷。如果卷内已有 `votes.sqlite`，这条命令会安全拒绝；不要使用 `docker compose down -v` 清空已有投票来绕过检查。

## 切换与验收

正式切换前，先用演练导出在新服务检查排行榜、总票数、搜索、投票和撤票。正式快照期间应暂停旧站投票写入，使用最终导出重新转换到另一个新文件，核对新旧 `/api/leaderboard` 的 `counts`、`totalVotes` 和 `totalVoters` 后再切流。演练快照之后新增的票不会自动同步。

同一时间只应有一个可写的权威投票数据库。旧 D1 与新 SQLite 若同时接受投票，会各自增长；该工具没有增量同步、合并重复身份或双向同步功能。保留旧 D1 和最终私有备份供回退，但回退前仍需处理新站切换后产生的投票。

**票数可以保留，浏览器 Cookie 不会自动跨域携带。** Worker 和 Node 使用相同的 HMAC-SHA256 签名格式，保留相同密钥时原 Cookie 的签名仍然兼容；只有浏览器实际带上该 Cookie，新服务才能识别旧身份。如果从 `workers.dev` 换到另一个域名，浏览器会获得新身份，原站投票仍在总数里，但用户不能直接在新身份下撤回旧票，还可能再次投票。不要向用户承诺跨域后仍能自动识别旧身份，也不要让用户公开 Cookie。收藏等原浏览器本地数据同样不会自动跨域转移。

## 输入边界与验证

只处理**自己账户中本项目数据库的可信、完整、未修改导出**，大小上限为 128 MiB。工具将导出 SQL 载入内存数据库，允许普通表、索引、触发器、事务以及 D1 常用的外键 PRAGMA，拒绝 ATTACH/DETACH、虚拟表、扩展函数、文件写入相关 PRAGMA 等操作。它不会把导出的建表语句、触发器、系统表或汇总表执行到目标库；目标表结构由工具重新创建，数据用参数化语句写入。

这些限制用于防止误用，不是面向任意不可信 SQL 的完整隔离沙箱。不要处理他人提供的 dump；过大的查询仍可能消耗内存或 CPU。如未来数据库 schema 或 Wrangler 导出格式改变，应先重新测试并审查工具，不要直接放开 SQL 权限。

```sh
node --test tests/vote-migration.test.mjs
```

测试包含真实 Wrangler 本地 D1 的建库、迁移、写入、导出、转换和 Node HTTP 接口验证，同时检查票数、历史 ID、时间戳、HMAC 身份兼容、已有目标保护、失败清理、SQL 文件访问拒绝及日志不泄露密钥。测试只使用合成身份与密钥，不访问生产数据库。
