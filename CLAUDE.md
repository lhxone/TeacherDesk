# TeacherDesk — 项目须知

## 数据库迁移安全规则（血的教训，务必遵守）

**2026-09-02 事故记录**：在给知识中心模块调迁移 SQL 时，先后对 `teacherdesk_test`（测试库）和
`teacherdesk`（本地开发库，含用户真实的 demo 账号、班级、学生等数据）执行了
`npx prisma migrate reset --force`，把开发库清空了，且没有备份可恢复。根因是把"改历史迁移文件
后需要 reset 拉回一致状态"这件事，在测试库和开发库上一视同仁地执行，没有意识到开发库是需要保护
的真实数据。

**规则：**

1. **`prisma migrate reset`（或任何带 `--force` 的破坏性 DB 命令）只允许对连接字符串包含
   `_test` 后缀数据库（即 `.env.test` / `teacherdesk_test`）执行。** 对 `.env` 指向的开发库
   (`teacherdesk`) 或任何生产库执行前，必须先查一遍这个库里是否有数据
   （如 `SELECT COUNT(*) FROM users`），如果非空，禁止 reset，改用下面的"追加迁移"方式。

2. **迁移文件一旦被 `prisma migrate dev`/`migrate deploy` 应用过，就不要再回头编辑它。**
   需要修正时新建一条追加迁移（哪怕只是改一个索引/触发器定义），而不是修改历史文件内容——
   编辑已应用的迁移文件会让 Prisma 认为数据库状态和迁移历史不一致，进而诱导人去用 `reset`
   "拉回一致"，这正是上面事故的直接导火索。

3. **生产环境永远只用 `prisma migrate deploy`**（`docker-compose.yml` 的 `migrate` 服务已经
   这样做），这个命令只会顺序应用尚未执行的迁移，不会 drop 数据库或清空任何数据，即使迁移历史
   有异常也只会报错退出而不是清库。**永远不要在生产 `DATABASE_URL` 下运行
   `migrate reset`/`migrate dev`。**

4. 执行任何 `DROP`/`TRUNCATE`/`reset` 类命令前，如果不能 100% 确定连接的是哪个库、库里有没有
   数据，先停下来问用户，而不是假设"这应该是空的/测试用的"。

## 本地开发环境已知坑

- **`server/.env` 不会被 `npm run dev` / `node dist/main.js` 自动加载**——只有 Prisma CLI
  （`npx prisma ...`）自带 `.env` 加载逻辑，容易误以为整个项目的 `.env` 都在生效。应用进程的
  加载靠 `server/src/loadEnv.ts`（作为 `main.ts` 的第一个 import，见该文件顶部注释说明为什么
  必须是"导入即生效"而不是导出函数再调用）。
- 本地环境用 PowerShell，不要用 Bash 工具——这台机器上 Bash（msys）在几乎所有调用下都会抛
  `fatal error - add_item ... errno 1`，是环境本身的问题，不是命令写错。
- 后台常驻进程（`npm run dev` 之类）必须用工具自带的 `run_in_background: true` 参数启动，
  不要用 `Start-Process`/`Start-Job` 手动搞——每次 PowerShell 工具调用都是全新的独立进程/会话，
  这类手动后台方式起的子进程会随宿主调用一起被杀掉，看起来"启动成功"但下一次调用时已经不在了。
