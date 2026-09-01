# 教师工作台 TeacherDesk

面向中小学教师的一体化工作台：班级、学生、日程、座位图、随机抽签/分组、成绩分析。
Web 优先，同时以 PWA 形式提供可安装的手机端体验。

---

## 功能

| 模块 | 能力 |
|---|---|
| 账号 | 注册、登录、JWT 鉴权、Refresh Token 轮换、修改密码 |
| 班级 | 增删改查、归档、按学年筛选 |
| 学生 | 增删改查、批量导入（含冲突预览）、标签、批量操作 |
| 日程 | 周课表（支持单双周）、日视图、待办事项（增删改查、勾选完成、关联班级） |
| 提醒 | 课程 / 待办开始前的 Web Push 推送（浏览器与已安装 PWA，关闭页面也能收到），提前分钟数可配置 |
| 座位图 | 拖拽排座、随机排座（可固定座位/前排优先）、多方案、打印 |
| 课堂工具 | 随机抽签（不重复/按权重）、随机分组（按成绩或性别均衡） |
| 成绩 | 考试管理、快捷录入、缺考标记、CSV 导出 |
| 分析 | 班级维度（分布/等级/趋势/排名）、学生维度（趋势/名次/雷达） |

---

## 技术栈

**后端** Node.js 20 · Fastify · Prisma · PostgreSQL 15 · Zod · JWT · web-push (VAPID)
**前端** Vue 3 · Vite · Pinia · Vue Router · ECharts · vite-plugin-pwa
**部署** Docker Compose · nginx · Cloudflare Tunnel

---

## 目录结构

```
TeacherDesk/
├── docs/
│   ├── PRD.md              产品需求文档
│   ├── ER.md               数据库设计与 ER 图
│   ├── API.md              接口文档
│   └── DEPLOY.md           部署文档
├── server/                 后端 API
│   ├── src/
│   │   ├── lib/            统计、座位、分组、抽签、日程等核心算法
│   │   ├── routes/         REST 路由
│   │   ├── app.ts          应用装配与鉴权中间件
│   │   └── main.ts         入口
│   ├── prisma/
│   │   ├── schema.prisma   数据模型
│   │   ├── migrations/     版本化的 schema 迁移历史
│   │   └── seed.ts         演示数据
│   └── tests/              179 个测试用例
├── web/                    前端 SPA + PWA
│   ├── src/
│   │   ├── api/            请求封装与类型
│   │   ├── components/     通用组件
│   │   ├── stores/         Pinia
│   │   └── views/          页面
│   └── nginx.conf          生产环境反向代理
├── deploy/db-init/         数据库初始化脚本
├── .github/workflows/      测试及 GHCR 镜像发布流水线
├── docker-compose.build.yml 本地构建覆盖配置
├── docker-compose.yml
└── .env.example
```

---

## 快速开始（本地开发）

```bash
# 1. 起数据库
docker run -d --name teacherdesk-pg \
  -e POSTGRES_PASSWORD=teacherdesk -e POSTGRES_USER=teacherdesk \
  -e POSTGRES_DB=teacherdesk -p 55432:5432 postgres:15-alpine

docker exec teacherdesk-pg psql -U teacherdesk -d teacherdesk \
  -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 2. 后端
cd server && npm install
npx prisma migrate deploy
npm run seed
npm run dev

# 3. 前端
cd web && npm install && npm run dev
```

访问 <http://localhost:5173> ，演示账号 `demo@teacherdesk.app` / `Demo12345`。

### 修改数据模型

改 `server/prisma/schema.prisma` 后用迁移文件记录变更，而不是 `db push`：

```bash
cd server
npx prisma migrate dev --name <改动描述，如 add_student_qq>
```

这会在 `prisma/migrations/` 下生成一份带 SQL 的迁移，应用到本地开发库并提交到仓库。
CI 与生产环境（`docker-compose.yml` 里的 `migrate` 服务）统一用
`prisma migrate deploy` 按顺序、幂等地应用这些迁移文件。

---

## 部署到 NAS

见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。要点：

```bash
cp .env.example .env    # 填入密码、JWT 密钥、Cloudflare 隧道 token
docker compose pull     # 从阿里云 ACR 拉取 API 与 Web 镜像（也同步发布到 ghcr.io/lhxone）
docker compose up -d
```

不开放任何端口，通过 Cloudflare Tunnel 对外提供 `https://t-desk.buildlink.cc`。
生产数据只写入 Docker 的 `db-data` volume，不会进入应用镜像。若需在本机从源码
构建，使用 `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`。

---

## 测试

```bash
cd server && npm test    # 179 用例：算法单测 + API 集成测试 + 越权隔离测试
cd web && npm test       # 10 用例：请求层、token 刷新与并发
```

测试覆盖了 PRD 中的验收标准，包括：

- **AC-1/AC-2** 未鉴权返回 401；越权访问返回 403，且不泄露资源是否存在
- **AC-3** 软删除班级后其学生与成绩不可通过 API 读取
- **AC-4** 批量导入冲突行标红且不写入，正确行照常写入
- **AC-6** 单周课程在双周不显示
- **AC-8** 随机排座保持固定座位不变
- **AC-9** 座位数少于学生数时拒绝保存并提示
- **AC-10** 不重复模式下一轮内每人恰好抽中一次
- **AC-11** 按成绩均衡分组时各组均分极差 ≤ 全班标准差
- **AC-12** 缺考不计入均分与及格率分母
- **AC-13** 学生仅一次考试时趋势图正常渲染

---

## 设计取舍

- **单教师数据模型**：没有学校/年级组织层级，每个账号的数据完全隔离。
  若后续要做校级版本，需要在 `classes` 上增加 `school_id` 并重构权限层。
- **座位图移动端只读**：触屏拖拽 6×8 网格易误操作，编辑限桌面端。
- **离线只读**：PWA 缓存班级、学生、今日日程与当前座位图；离线时禁止写操作，
  避免多端冲突造成数据错乱。
- **缓存按隐私分级**：Service Worker 的缓存只按 URL 存储、不区分账号，因此
  `/auth/*` 与 `/analytics/*` 完全不缓存，名单类接口用 NetworkFirst（而非
  StaleWhileRevalidate），并在登录/登出/改密码/token 失效时清空。详见
  `docs/API.md` 附录 B。
- **表单一律关闭浏览器自动填充**：学生姓名、电话等字段描述的是学生而非教师本人，
  开启自动填充会让浏览器把设备主人的信息覆盖到真实学生记录上。
- **统计口径固定**：标准差用总体标准差（分母 N），名次同分并列跳号（1,2,2,4），
  缺考排除在统计之外。详见 `docs/ER.md` §5。
