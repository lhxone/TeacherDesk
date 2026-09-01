# TeacherDesk 部署文档

## 1. 项目架构

```
┌─────────────────────────────────────────────────────────────┐
│                    家庭服务器 (Docker)                       │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   cloudflared│    │    web      │    │    api      │     │
│  │  (Tunnel)   │───▶│  (nginx)    │───▶│  (Fastify)  │     │
│  │             │    │   :80       │    │   :3000     │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                                      │            │
│         └──────────────────────────────────────┘            │
│                            │                                │
│                    ┌───────▼───────┐                        │
│                    │      db       │                        │
│                    │  (PostgreSQL) │                        │
│                    │    :5432      │                        │
│                    └───────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (出站连接)
                   ┌────────────────┐
                   │   Cloudflare   │
                   │    边缘节点     │
                   └────────┬───────┘
                            │
                            ▼
                      浏览器访问
               https://t-desk.buildlink.cc
```

**关键特性：**
- 服务器不暴露任何端口，仅通过 Cloudflare Tunnel 出站连接
- 所有服务运行在 Docker 内部网络，不对外暴露
- 镜像从 GHCR（GitHub Container Registry）拉取

---

## 2. 前置准备

### 2.1 服务器要求

- Docker 20.10+
- Docker Compose v2
- 至少 1GB 可用内存、2GB 磁盘空间
- 能访问阿里云容器镜像服务（用于拉取镜像）

### 2.2 登录阿里云 ACR（必须先做）

镜像托管在阿里云容器镜像服务（ACR），仓库为私有，**必须先登录**才能拉取，否则会报 `denied` 错误。
（此前用的是 GHCR——从国内网络拉取时经常在某个镜像层卡死不动，改用国内可直连的 ACR 后不再有这个问题。）

```bash
docker login crpi-7l6kwk12l9aqux5u.cn-hangzhou.personal.cr.aliyuncs.com
# 用户名为阿里云账号全名，密码为 ACR 访问凭证页设置的仓库登录密码
```

看到 `Login Succeeded` 表示登录成功。登录信息会保存在 `~/.docker/config.json` 中，后续拉取无需重复登录。

### 2.3 Cloudflare 配置

1. **创建 Tunnel：**
   - 登录 [Zero Trust 控制台](https://one.dash.cloudflare.com/)
   - 进入 Networks → Tunnels → Create a tunnel
   - 选择 Cloudflared 类型
   - 记录 Tunnel Token（`eyJ...` 开头的长字符串）

2. **配置 Public Hostname：**

   | 字段 | 值 |
   |---|---|
   | Subdomain | `t-desk` |
   | Domain | `buildlink.cc` |
   | Type | `HTTP` |
   | URL | `web:80` |

   **注意：** URL 填 `web:80`（Docker 内部服务名），不是 localhost。

---

## 3. 部署步骤

### 3.1 创建项目目录

```bash
mkdir -p /opt/teacherdesk
cd /opt/teacherdesk
```

### 3.2 下载配置文件

```bash
# 方法一：从 GitHub 仓库下载（推荐）
curl -sL https://raw.githubusercontent.com/lhxone/TeacherDesk/main/docker-compose.yml -o docker-compose.yml
curl -sL https://raw.githubusercontent.com/lhxone/TeacherDesk/main/.env.example -o .env.example

# 方法二：如果已克隆仓库，直接复制
# cp /path/to/TeacherDesk/docker-compose.yml .
# cp /path/to/TeacherDesk/.env.example .
```

### 3.3 创建环境变量文件

```bash
cp .env.example .env
```

### 3.4 生成密钥并配置 .env

```bash
# 生成数据库密码
POSTGRES_PASSWORD=$(openssl rand -base64 24)
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"

# 生成 JWT 密钥
JWT_SECRET=$(openssl rand -base64 48)
echo "JWT_SECRET=$JWT_SECRET"
```

编辑 `.env` 文件，填入生成的密钥和 Tunnel Token：

```bash
cat > .env << EOF
# 应用镜像标签（GitHub Actions 构建时生成）
TEACHERDESK_IMAGE_TAG=latest

# 数据库配置
POSTGRES_USER=teacherdesk
POSTGRES_DB=teacherdesk
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# API 配置
JWT_SECRET=${JWT_SECRET}
BCRYPT_ROUNDS=12

# 公共访问地址
PUBLIC_ORIGIN=https://t-desk.buildlink.cc

# Cloudflare Tunnel Token
CLOUDFLARE_TUNNEL_TOKEN=YOUR_TUNNEL_TOKEN_HERE
EOF
```

**安全提示：**
- `.env` 文件不要提交到 Git
- 建议设置权限：`chmod 600 .env`
- 更换 `JWT_SECRET` 会导致所有用户需要重新登录

### 3.4.1 （可选）启用推送提醒

课程 / 待办开始前的推送提醒依赖 Web Push，需要一对 VAPID 密钥。不配置则功能自动关闭，其余部分照常运行。

```bash
# 在任意装有 server 依赖的机器上生成一次，长期有效
cd server && npx web-push generate-vapid-keys
```

把输出填入 `.env`：

```bash
VAPID_PUBLIC_KEY=BM...        # Public Key
VAPID_PRIVATE_KEY=xxxxx       # Private Key
VAPID_SUBJECT=mailto:you@example.com
# 教师所在时区（UTC 以东分钟数，480 = UTC+8）。课表节次时间按此时区解释。
LOCAL_TZ_OFFSET_MINUTES=480
```

- 密钥只需生成一次。更换密钥后**无需**用户手动操作：前端会检测到旧订阅使用的公钥
  与服务端不一致，自动退订并重新订阅。
- 推送要求站点为 HTTPS（Cloudflare Tunnel 已满足）。
- iOS 需先「添加到主屏幕」，且系统版本 ≥ 16.4。
- 后端进程内每分钟扫描一次即将开始的课程 / 待办；提醒去重记录在 `sent_reminders` 表，重启不会重复推送。

**推送排查**（用户反馈「收不到通知」时）：

1. 打开「个人设置 → 推送提醒 → 设备管理」。「服务端推送」显示"未配置"说明
   `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` 没设或 api 容器没重启。
2. 「本浏览器」显示"已拒绝"→ 用户需在浏览器站点设置里手动允许通知。
3. 状态都正常但仍收不到：`docker compose logs api | grep "web push delivery failed"`，
   `statusCode` 为 `403` 通常是 VAPID 密钥被换过且前端缓存了旧订阅（新版本会自愈，
   让用户刷新页面即可）；`410` 是订阅已失效，会自动清理。
4. 设置页「发送测试通知」返回"已发送到 N 台设备"但收不到 → 多为系统/浏览器层面
   屏蔽了通知（勿扰模式、通知权限、省电策略）。

### 3.5 启动服务

```bash
# 拉取最新镜像
docker compose pull

# 启动所有服务
docker compose up -d
```

### 3.6 验证部署

```bash
# 查看服务状态
docker compose ps
```

预期输出：

```
NAME                      STATUS
teacherdesk-api-1         Up (healthy)
teacherdesk-cloudflared-1 Up
teacherdesk-db-1          Up (healthy)
teacherdesk-migrate-1     Exited (0)
teacherdesk-web-1         Up (healthy)
```

**注意：** `migrate` 显示 `Exited (0)` 是正常的，它是一次性数据库迁移任务。

```bash
# 检查 API 健康状态
docker compose exec web wget -qO- http://api:3000/api/v1/health

# 检查隧道连接
docker compose logs cloudflared | grep -i "registered\|connection"
```

### 3.7 访问站点

打开浏览器访问：**https://t-desk.buildlink.cc**

第一个注册的用户即为普通教师账号。

---

## 4. 常用运维命令

### 4.1 更新版本

```bash
cd /opt/teacherdesk

# 拉取最新镜像
docker compose pull

# 重启服务
docker compose up -d
```

### 4.2 查看日志

```bash
# 查看所有服务日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f api
docker compose logs -f web
docker compose logs -f cloudflared
```

### 4.3 重启服务

```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart api
```

### 4.4 停止服务

```bash
# 停止所有服务（数据保留在 volume 中）
docker compose down

# 停止并删除数据卷（⚠️ 会丢失所有数据）
docker compose down -v
```

---

## 5. 数据备份与恢复

### 5.1 备份数据库

```bash
# 导出数据库并压缩
docker compose exec -T db pg_dump -U teacherdesk teacherdesk \
  | gzip > backup-$(date +%Y%m%d-%H%M%S).sql.gz

# 示例输出：backup-20260830-143022.sql.gz
```

建议使用 cron 定时任务每天自动备份。

### 5.2 恢复数据库

```bash
# 从备份恢复
gunzip -c backup-20260830-143022.sql.gz \
  | docker compose exec -T db psql -U teacherdesk -d teacherdesk
```

---

## 6. 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 站点无法访问（502） | web 服务未启动 | `docker compose ps` 检查状态；`docker compose logs web` 查看日志 |
| 隧道未连接 | Token 无效或过期 | 检查 `CLOUDFLARE_TUNNEL_TOKEN`；查看 `docker compose logs cloudflared` |
| 登录后 401 错误 | JWT_SECRET 被更改 | 重新登录；或确保 `.env` 中 JWT_SECRET 一致 |
| 数据库连接失败 | 数据库未就绪 | 首次启动需等待 20-30 秒；检查 `docker compose logs db` |
| migrate 失败 | 数据库卷中的旧密码与 `.env` 不符 | `POSTGRES_PASSWORD` 只在首次初始化时写入数据卷；改密码后需 `docker compose down -v` 重建卷（⚠️ 会清空数据），或直接进 db 容器用 `ALTER USER` 改回 |

### 查看容器日志

```bash
# 查看 API 容器内部
docker compose exec api sh

# 直接连接数据库
docker compose exec db psql -U teacherdesk -d teacherdesk

# 查看数据库索引
docker compose exec db psql -U teacherdesk -d teacherdesk -c "\di uq_*"
```

---

## 7. 镜像信息

GitHub Actions 构建的镜像同时推送到 GHCR 和阿里云 ACR；`docker-compose.yml` 使用 ACR（国内网络更稳定）：

- **API 镜像：** `crpi-7l6kwk12l9aqux5u.cn-hangzhou.personal.cr.aliyuncs.com/lhxone/teacherdesk-api`（镜像：`ghcr.io/lhxone/teacherdesk-api`）
- **Web 镜像：** `crpi-7l6kwk12l9aqux5u.cn-hangzhou.personal.cr.aliyuncs.com/lhxone/teacherdesk-web`（镜像：`ghcr.io/lhxone/teacherdesk-web`）

可用标签：
- `latest` - 最新的 main 分支构建
- `v*` - 版本标签（如 `v1.0.0`）
- `sha-*` - 特定提交的构建

---

## 8. 安全建议

1. **启用 Cloudflare Access（强烈推荐）**
   - Zero Trust → Access → Applications → Add an application → Self-hosted
   - 配置邮箱白名单，限制访问权限

2. **启用安全功能**
   - Bot Fight Mode
   - Rate Limiting
   - WAF 托管规则

3. **定期维护**
   - 定期轮换 `JWT_SECRET`
   - 定期备份数据库
   - 保持镜像更新到最新版本

---

## 9. 本地开发

如需本地开发，请参考项目 README 中的开发指南。

快速启动本地环境：

```bash
# 启动 PostgreSQL
docker run -d --name teacherdesk-pg \
  -e POSTGRES_PASSWORD=teacherdesk \
  -e POSTGRES_USER=teacherdesk \
  -e POSTGRES_DB=teacherdesk \
  -p 55432:5432 postgres:15-alpine

# 初始化数据库
docker exec teacherdesk-pg psql -U teacherdesk -d teacherdesk \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 启动后端（需先安装依赖）
cd server && npm install && npm run dev

# 启动前端（需先安装依赖）
cd web && npm install && npm run dev
```
