# TeacherDesk 部署文档（家庭 NAS + Cloudflare Tunnel）

目标：在家庭 NAS 上以 Docker Compose 运行，通过 Cloudflare Tunnel 对外提供
`https://t-desk.buildlink.cc`，**不在路由器上开放任何端口**。

---

## 1. 架构

```
                    ┌──────────────────────────┐
   浏览器 ──HTTPS──▶ │   Cloudflare 边缘节点     │
                    └────────────┬─────────────┘
                                 │ 隧道（出站长连接）
                    ┌────────────▼─────────────┐
                    │  NAS · Docker Compose     │
                    │                           │
                    │  cloudflared              │
                    │       │                   │
                    │       ▼                   │
                    │  web (nginx:80)           │
                    │    ├─ /        → SPA 静态资源
                    │    └─ /api/    → api:3000 │
                    │              │            │
                    │              ▼            │
                    │           api (Fastify)   │
                    │              │            │
                    │              ▼            │
                    │           db (PostgreSQL) │
                    └───────────────────────────┘
```

关键点：

- **没有任何 `ports:` 映射**。NAS 上不监听任何对外端口，局域网内也访问不到容器。
- **cloudflared 只做出站连接**，主动连到 Cloudflare，不接受入站连接。
- **同源部署**：nginx 同时提供前端静态资源和 `/api` 反向代理，浏览器只与
  `t-desk.buildlink.cc` 一个域名通信，因此没有跨域（CORS）预检请求。
- **数据库只在内部网络**，不对外暴露，也不映射到宿主机。

---

## 2. 前置准备

### 2.1 NAS 要求
- 已安装 Docker 与 Docker Compose v2（群晖：Container Manager；威联通：Container Station）
- 至少 1 GB 可用内存、2 GB 磁盘
- 因 GitHub 仓库与 GHCR 包默认为私有，准备一个仅有 `read:packages` 权限的
  GitHub token，并在 NAS 上登录一次：
  ```bash
  echo "$GHCR_TOKEN" | docker login ghcr.io -u lhxone --password-stdin
  unset GHCR_TOKEN
  ```
  token 只应临时放在 shell 环境中，不要写入本项目的 `.env`。

### 2.2 Cloudflare 侧配置

1. 域名 `buildlink.cc` 已托管在 Cloudflare。
2. 进入 **Zero Trust 控制台 → Networks → Tunnels → Create a tunnel**
   - 类型选 **Cloudflared**
   - 隧道名称随意，例如 `nas-teacherdesk`
3. 创建后会显示一条安装命令，形如：
   ```
   cloudflared service install eyJhIjoiXXXX....
   ```
   **复制其中那串很长的 token**（`eyJ...` 开头），稍后填入 `.env`。
4. 切到该隧道的 **Public Hostnames** 标签，点击 **Add a public hostname**：

   | 字段 | 值 |
   |---|---|
   | Subdomain | `t-desk` |
   | Domain | `buildlink.cc` |
   | Type | `HTTP` |
   | URL | `web:80` |

   > URL 必须填 `web:80`——这是 Compose 内部的服务名，
   > cloudflared 与 web 在同一个 Docker 网络里，直接按服务名解析。
   > 这里填 `HTTP` 不影响对外的 HTTPS：TLS 由 Cloudflare 在边缘终止。

5. 保存后 Cloudflare 会自动创建 `t-desk` 的 CNAME 记录，无需手工添加 DNS。

---

## 3. 部署步骤

### 3.1 获取代码

只需把部署配置放到 NAS 上（也可以直接 clone 仓库）：

```bash
cd /volume1/docker/teacherdesk
ls    # 应能看到 docker-compose.yml、.env.example、deploy/
```

### 3.2 生成配置

```bash
cp .env.example .env
```

编辑 `.env`，把三个 `CHANGE_ME` 换成真实值：

```bash
# 生成数据库密码
openssl rand -base64 24

# 生成 JWT 密钥
openssl rand -base64 48
```

```ini
POSTGRES_PASSWORD=<上面生成的密码>
JWT_SECRET=<上面生成的密钥>
CLOUDFLARE_TUNNEL_TOKEN=<第 2.2 步复制的 token>
PUBLIC_ORIGIN=https://t-desk.buildlink.cc
TEACHERDESK_IMAGE_TAG=latest
```

> `JWT_SECRET` 一旦更换，所有已登录用户都需要重新登录。
> 请妥善备份 `.env`，但**不要提交到 Git**。

### 3.3 启动

```bash
docker compose pull
docker compose up -d
```

`api` 与 `web` 会直接从 `ghcr.io/lhxone/teacherdesk-api` 和
`ghcr.io/lhxone/teacherdesk-web` 拉取。正式发布后建议把
`TEACHERDESK_IMAGE_TAG` 固定为版本标签（如 `v1.0.0`），避免 `latest` 漂移。

首次启动会依次完成：
1. `db` 初始化数据库并创建 `pgcrypto` 扩展
2. `migrate` 建表 + 创建部分唯一索引，完成后自动退出（这是正常的）
3. `api`、`web`、`cloudflared` 启动

查看状态：

```bash
docker compose ps
```

预期输出（`migrate` 显示 `Exited (0)` 属正常）：

```
NAME                      STATUS
teacherdesk-api-1         Up (healthy)
teacherdesk-cloudflared-1 Up
teacherdesk-db-1          Up (healthy)
teacherdesk-migrate-1     Exited (0)
teacherdesk-web-1         Up (healthy)
```

### 3.4 验证

```bash
# 容器内部自检
docker compose exec web wget -qO- http://127.0.0.1/healthz
# 期望：ok

docker compose exec web wget -qO- http://api:3000/api/v1/health
# 期望：{"status":"ok","version":"1.0.0","time":"..."}

# 隧道连接状态
docker compose logs cloudflared | grep -i "registered\|connection"
```

浏览器打开 <https://t-desk.buildlink.cc> ，应看到登录页。

### 3.5 创建第一个账号

打开站点点「立即注册」即可。系统没有预置管理员——第一个注册的人就是普通教师账号，
每个账号的数据彼此隔离。

---

## 4. 日常运维

### 4.1 更新版本

```bash
cd /volume1/docker/teacherdesk
git pull                        # 或手工替换代码
docker compose pull
docker compose up -d
```

`migrate` 会自动重跑并同步表结构变更。

### 4.2 备份数据库

```bash
docker compose exec -T db pg_dump -U teacherdesk teacherdesk \
  | gzip > backup-$(date +%F).sql.gz
```

建议加到 NAS 的计划任务里，每天执行一次。

### 4.3 恢复数据库

```bash
gunzip -c backup-2026-08-30.sql.gz \
  | docker compose exec -T db psql -U teacherdesk -d teacherdesk
```

### 4.4 查看日志

```bash
docker compose logs -f api          # 后端
docker compose logs -f web          # nginx 访问日志
docker compose logs -f cloudflared  # 隧道
```

### 4.5 停止 / 重启

```bash
docker compose restart api   # 只重启后端
docker compose down          # 停止全部（数据保留在 db-data 卷中）
docker compose down -v       # ⚠️ 连数据卷一起删除，数据会丢失
```

---

## 5. 安全加固（建议）

### 5.1 加一层 Cloudflare Access（强烈推荐）

应用本身只有邮箱+密码登录。由于站点公开可访问，任何人都能注册账号。
如果只想让自己（或指定几位老师）使用，在 Cloudflare 前面再加一道认证：

**Zero Trust → Access → Applications → Add an application → Self-hosted**

| 字段 | 值 |
|---|---|
| Application name | TeacherDesk |
| Session duration | 30 天（按需） |
| Subdomain / Domain | `t-desk` / `buildlink.cc` |

然后添加 Policy：
- Action: **Allow**
- Include: **Emails** → 填入允许访问的邮箱地址

这样未通过 Cloudflare 身份验证的人连登录页都打不开。

### 5.2 其他建议

- 开启 Cloudflare 的 **Bot Fight Mode** 与 **Rate Limiting**
- 在 Zero Trust 中开启 **WAF** 托管规则
- 定期轮换 `JWT_SECRET`（会强制所有人重新登录）
- `.env` 权限设为 `chmod 600`

---

## 6. 故障排查

| 现象 | 排查方向 |
|---|---|
| 站点 502 / 无法访问 | `docker compose ps` 看 `web` 是否 healthy；Public Hostname 的 URL 是否填的 `web:80` |
| 隧道未连接 | `docker compose logs cloudflared`；确认 token 完整无换行、无引号 |
| 登录后接口 401 | `JWT_SECRET` 是否被改过；改过则需重新登录 |
| `migrate` 一直失败 | `docker compose logs migrate`；多半是 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 不一致 |
| 数据库连不上 | `docker compose logs db`；首次启动需等待 20–30 秒 |
| 页面是旧版本 | 强制刷新（Ctrl+Shift+R）；Service Worker 会在下次访问自动更新 |
| 中文排序异常 | 数据库以 `--locale=C` 初始化，按 UTF-8 字节序排序；改排序规则需重建数据库 |
| `migrate` 报 `Can't write to @prisma/engines` | 见下方「Prisma 引擎问题」 |

### Prisma 引擎问题（Alpine 镜像）

若 `migrate` 日志出现：

```
prisma:warn Prisma failed to detect the libssl/openssl version to use...
Error: Can't write to /app/node_modules/@prisma/engines
```

这条报错具有误导性——它并不是权限问题，而是 Prisma 没找到匹配当前系统的
查询引擎，于是想联网下载，而容器里既没有网络、运行用户也不该有写权限。

两处防护已经内置在本项目中，改动时不要破坏：

1. `server/prisma/schema.prisma` 中固定了引擎目标：
   ```prisma
   binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
   ```
2. `docker-compose.yml` 中 `migrate` 与 `api` **共用同一个 image**
   （`image: teacherdesk-api`）。若给两者各写一份 `build:`，Docker 会构建出
   两个独立缓存的镜像；只重建其中一个时，另一个会悄悄停留在旧版本，
   表现就是「同样的命令 `docker run` 能跑、`docker compose` 却失败」。

重建镜像时如遇缓存异常：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml build --no-cache api
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --force-recreate
```

### 镜像与数据边界

- GitHub Actions 每次都从仓库源码构建镜像，不读取本地 `.env`、数据库或备份。
- API 镜像只包含编译产物、依赖、Prisma schema 和建库索引脚本；Web 镜像只包含静态资源与 nginx 配置。
- `seed.ts` 不会在构建或启动时执行，新数据库首次启动后为空，不含演示账号或业务数据。
- PostgreSQL 数据仅保存在运行时 `db-data` volume 中。删除 volume 才会清空数据。

### 查看容器内部状态

```bash
# 进入 api 容器
docker compose exec api sh

# 直接连数据库
docker compose exec db psql -U teacherdesk -d teacherdesk

# 确认部分唯一索引已创建
docker compose exec db psql -U teacherdesk -d teacherdesk \
  -c "\di uq_*"
```

---

## 7. 本地开发（非 NAS）

```bash
# 1. 起一个本地 Postgres
docker run -d --name teacherdesk-pg \
  -e POSTGRES_PASSWORD=teacherdesk \
  -e POSTGRES_USER=teacherdesk \
  -e POSTGRES_DB=teacherdesk \
  -p 55432:5432 postgres:15-alpine

docker exec teacherdesk-pg psql -U teacherdesk -d teacherdesk \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 2. 后端
cd server
npm install
npx prisma db push
npx prisma db execute --file prisma/partial-indexes.sql --schema prisma/schema.prisma
npm run seed        # 可选：写入演示数据
npm run dev         # http://localhost:3000

# 3. 前端（另开一个终端）
cd web
npm install
npm run dev         # http://localhost:5173
```

演示账号：`demo@teacherdesk.app` / `Demo12345`

### 运行测试

```bash
cd server && npm test     # 179 个用例
cd web && npm test        # 10 个用例
```

后端测试需要一个 `teacherdesk_test` 数据库：

```bash
docker exec teacherdesk-pg psql -U teacherdesk -d teacherdesk \
  -c "CREATE DATABASE teacherdesk_test;"
docker exec teacherdesk-pg psql -U teacherdesk -d teacherdesk_test \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

cd server
DATABASE_URL="postgresql://teacherdesk:teacherdesk@localhost:55432/teacherdesk_test?schema=public" \
  npx prisma db push
```
