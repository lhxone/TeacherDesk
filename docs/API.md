# TeacherDesk API 文档 v1

- Base URL：`https://api.teacherdesk.app/api/v1`（本地：`http://localhost:3000/api/v1`）
- 传输：HTTPS，`Content-Type: application/json; charset=utf-8`
- 鉴权：`Authorization: Bearer <accessToken>`
- 时间格式：ISO 8601 UTC，如 `2026-08-30T02:11:00Z`
- ID 格式：UUID v4 字符串

---

## 0. 通用约定

### 0.1 成功响应

单个资源：

```json
{ "data": { "id": "…", "name": "高二(3)班" } }
```

列表（分页）：

```json
{
  "data": [ { "id": "…" } ],
  "meta": { "page": 1, "pageSize": 20, "total": 137, "totalPages": 7 }
}
```

### 0.2 错误响应

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数校验失败",
    "details": [ { "field": "email", "message": "邮箱格式不正确" } ],
    "requestId": "req_01H8…"
  }
}
```

| HTTP | code | 说明 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 参数校验失败 |
| 401 | `UNAUTHENTICATED` | 缺少 / 无效 / 过期 token |
| 403 | `FORBIDDEN` | 资源不属于当前用户 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 唯一性冲突（邮箱已注册、学号重复、座位被占） |
| 422 | `BUSINESS_RULE_VIOLATION` | 业务规则不满足（如座位数少于学生数） |
| 429 | `RATE_LIMITED` | 触发限流，响应带 `Retry-After` |
| 500 | `INTERNAL_ERROR` | 服务端异常 |

> 安全约定：访问他人资源统一返回 **403** 且不区分「不存在」与「无权限」，避免 ID 枚举探测。

### 0.3 分页与排序

所有列表接口支持：

| 参数 | 默认 | 说明 |
|---|---|---|
| `page` | 1 | 页码，从 1 起 |
| `pageSize` | 20 | 每页条数，最大 100 |
| `sort` | 各接口定义 | 形如 `sort=name` / `sort=-createdAt`（`-` 表示降序） |

### 0.4 限流

| 范围 | 限制 |
|---|---|
| `/auth/login`、`/auth/register` | 每 IP 10 次 / 分钟 |
| 其他接口 | 每用户 120 次 / 分钟 |
| 分析类接口 | 每用户 30 次 / 分钟 |

---

## 1. 鉴权 Auth

### POST /auth/register — 注册

请求：

```json
{
  "email": "teacher@example.com",
  "password": "Passw0rd123",
  "displayName": "李老师"
}
```

响应 `201`：

```json
{
  "data": {
    "user": { "id": "…", "email": "teacher@example.com", "displayName": "李老师", "avatarUrl": null },
    "accessToken": "eyJhbGci…",
    "refreshToken": "rt_9f2c…",
    "sessionId": "…",
    "expiresIn": 7200
  }
}
```

`sessionId` 是本次登录对应的 refresh-token 会话 id，前端存下后可在设备管理页标记「本机」。

错误：`409 CONFLICT`（邮箱已注册）、`400 VALIDATION_ERROR`（密码强度不足）

---

### POST /auth/login — 登录

请求：

```json
{ "email": "teacher@example.com", "password": "Passw0rd123", "rememberMe": true }
```

响应 `200`：结构同注册。`rememberMe=true` 时 refreshToken 有效期 30 天，否则 7 天。

错误：`401 UNAUTHENTICATED`（邮箱或密码错误，不区分提示）、`429 RATE_LIMITED`（连续 5 次失败锁定 15 分钟）

---

### POST /auth/refresh — 刷新令牌

请求：`{ "refreshToken": "rt_9f2c…" }`

响应 `200`：

```json
{ "data": { "accessToken": "eyJ…", "refreshToken": "rt_new…", "sessionId": "…", "expiresIn": 7200 } }
```

> 采用 rotation：旧 refreshToken 立即失效。若检测到已失效的 token 被复用，撤销该用户全部 token 并返回 `401`。

---

### POST /auth/logout — 登出

请求：`{ "refreshToken": "rt_9f2c…", "allDevices": false }`
响应 `204`

---

### GET /auth/me — 当前用户

响应 `200`：

```json
{
  "data": {
    "id": "…", "email": "teacher@example.com", "displayName": "李老师",
    "avatarUrl": null,
    "settings": { "periodsPerDay": 8, "showWeekend": false,
      "gradeThresholds": { "excellent": 0.85, "good": 0.75, "pass": 0.6 },
      "daySchedule": [ { "key": "p1", "kind": "lesson", "label": "第1节", "start": "08:00", "end": "08:45", "period": 1 } ] },
    "createdAt": "2026-08-01T09:00:00Z"
  }
}
```

---

### PATCH /auth/me — 更新个人信息

请求（字段均可选）：`{ "displayName": "李老师", "avatarUrl": "https://…", "settings": { "periodsPerDay": 9 } }`
响应 `200`：同 `GET /auth/me`

`settings.daySchedule` 为作息时间表：每项 `{ key, kind: "lesson"|"activity", label, start: "HH:MM", end: "HH:MM" }`，
服务端会按 `start` 排序并给 `kind: "lesson"` 的项自动编号 `period`（1..N）。
`start >= end` 或时间格式非法 → `400 VALIDATION_ERROR`。旧账号无此字段时按默认作息处理。

---

### POST /auth/change-password — 修改密码

请求：`{ "currentPassword": "old…", "newPassword": "new…" }`
响应 `204`。副作用：撤销其他所有设备的 refreshToken。

---

## 2. 班级 Classes

### GET /classes — 班级列表

Query：`status`（`active`｜`archived`｜`all`，默认 `active`）、`academicYear`、`page`、`pageSize`、`sort`（默认 `-createdAt`）

响应 `200`：

```json
{
  "data": [{
    "id": "cls_…", "name": "高二(3)班", "subject": "数学",
    "academicYear": "2026-2027", "color": "#3B82F6", "note": "",
    "status": "active", "studentCount": 48,
    "latestExam": { "id": "exm_…", "name": "第一次月考", "avg": 78.4, "examDate": "2026-09-25" },
    "createdAt": "2026-08-20T01:00:00Z"
  }],
  "meta": { "page": 1, "pageSize": 20, "total": 3, "totalPages": 1 }
}
```

### POST /classes — 新建班级

请求：`{ "name": "高二(3)班", "subject": "数学", "academicYear": "2026-2027", "color": "#3B82F6", "note": "" }`
响应 `201`

### GET /classes/{classId} — 班级详情
### PATCH /classes/{classId} — 更新班级（含 `status` 改为 `archived` 归档）
### DELETE /classes/{classId} — 删除班级（软删除，级联隐藏学生 / 成绩 / 座位图）→ `204`

---

## 3. 学生 Students

### GET /classes/{classId}/students — 学生列表

Query：`q`（姓名 / 学号模糊搜索）、`tagIds`（逗号分隔）、`status`、`page`、`pageSize`、`sort`（`studentNo` | `name` | `sortOrder`，默认 `sortOrder`）

响应 `200`：

```json
{
  "data": [{
    "id": "stu_…", "classId": "cls_…", "name": "张三", "studentNo": "01",
    "gender": "male", "avatarUrl": null, "phone": "138****0000",
    "note": "", "sortOrder": 1, "status": "active",
    "tags": [{ "id": "tag_…", "name": "课代表", "color": "#10B981" }]
  }],
  "meta": { "page": 1, "pageSize": 50, "total": 48, "totalPages": 1 }
}
```

### POST /classes/{classId}/students — 新增学生

请求：`{ "name": "张三", "studentNo": "01", "gender": "male", "phone": "13800000000", "note": "", "tagIds": ["tag_…"] }`
响应 `201`。学号重复 → `409 CONFLICT`

---

### POST /classes/{classId}/students/bulk-import — 批量导入

请求：

```json
{
  "dryRun": true,
  "students": [
    { "name": "张三", "studentNo": "01", "gender": "male" },
    { "name": "李四", "studentNo": "01" }
  ]
}
```

响应 `200`（`dryRun: true` 预览）：

```json
{
  "data": {
    "total": 2, "valid": 1, "invalid": 1,
    "rows": [
      { "index": 0, "status": "ok", "student": { "name": "张三", "studentNo": "01" } },
      { "index": 1, "status": "error", "errors": ["学号 01 在本班已存在"] }
    ]
  }
}
```

`dryRun: false` 时实际写入，响应额外返回 `created` 数量；整批中的错误行被跳过，正确行照常写入。

---

### GET /classes/{classId}/students/import-template — 下载学生导入模板

响应 `200`：`.xlsx` 文件（`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`），
表头为 学号 / 姓名 / 性别 / 联系电话，空白待填写。

### POST /classes/{classId}/students/import-file — 上传学生导入模板

请求：`multipart/form-data`，字段 `file` 为填好的 `.xlsx` 文件；query 参数 `dryRun`（默认 `true`）。
解析结果与 `bulk-import` 响应结构相同（`total/valid/invalid/created/dryRun/rows`）。非 `.xlsx` 或空文件 → `400 VALIDATION_ERROR`。

---

### GET /students/{studentId} — 学生详情

响应 `200`：基础字段 + 聚合信息

```json
{
  "data": {
    "id": "stu_…", "name": "张三", "studentNo": "01", "classId": "cls_…",
    "className": "高二(3)班", "gender": "male", "phone": "13800000000",
    "note": "上课注意力需引导", "status": "active",
    "tags": [{ "id": "tag_…", "name": "需关注", "color": "#F59E0B" }],
    "stats": { "examCount": 6, "avgScore": 82.3, "avgRank": 12, "lotteryCount": 4 },
    "currentSeat": { "seatingChartId": "sea_…", "rowIndex": 2, "colIndex": 3 }
  }
}
```

### PATCH /students/{studentId} — 更新学生
### DELETE /students/{studentId} — 删除学生（软删除）→ `204`

### PATCH /classes/{classId}/students/batch — 批量操作

请求：

```json
{ "studentIds": ["stu_a", "stu_b"], "action": "addTags", "payload": { "tagIds": ["tag_x"] } }
```

`action` 取值：`addTags` | `removeTags` | `setStatus` | `delete`
响应 `200`：`{ "data": { "affected": 2 } }`

---

## 4. 标签 Tags

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tags` | 当前用户全部标签 |
| POST | `/tags` | 新建 `{ "name": "课代表", "color": "#10B981" }` |
| PATCH | `/tags/{tagId}` | 更新 |
| DELETE | `/tags/{tagId}` | 删除（同时解除所有学生关联）|

---

## 5. 日程 Schedule

### GET /schedule/slots — 周课表

Query：`weekday`（可选，1–7）

响应 `200`：

```json
{
  "data": [{
    "id": "slt_…", "classId": "cls_…", "className": "高二(3)班",
    "classColor": "#3B82F6", "subject": "数学",
    "weekday": 1, "period": 2, "location": "教学楼A301",
    "repeatRule": "weekly", "startDate": "2026-09-01", "endDate": "2027-01-15",
    "note": ""
  }]
}
```

### POST /schedule/slots — 新增课程条目
请求体同上（不含只读字段）。同一 `weekday + period + repeatRule` 已占用 → `409 CONFLICT`

### PATCH /schedule/slots/{slotId} / DELETE /schedule/slots/{slotId}

---

### GET /schedule/agenda — 指定日期的日程（课程 + 待办合并）

Query：`date=2026-09-14`（必填）或 `from=…&to=…`（区间，最长 31 天）

响应 `200`：

```json
{
  "data": [{
    "date": "2026-09-14", "weekday": 1, "weekParity": "odd",
    "lessons": [{
      "slotId": "slt_…", "period": 2, "startTime": "09:00", "endTime": "09:45",
      "subject": "数学", "classId": "cls_…", "className": "高二(3)班",
      "classColor": "#3B82F6", "location": "教学楼A301"
    }],
    "timeline": [
      { "kind": "activity", "label": "早读", "start": "07:30", "end": "07:50" },
      { "kind": "lesson", "label": "第1节", "start": "08:00", "end": "08:45",
        "period": 1, "slotId": null, "subject": null, "classId": null,
        "className": null, "classColor": null, "location": null }
    ],
    "events": [{
      "id": "evt_…", "title": "收作业本", "startAt": "2026-09-14T09:00:00Z",
      "allDay": false, "isDone": false, "classId": "cls_…"
    }]
  }]
}
```

> 后端负责按 `repeatRule` 与学期区间过滤单双周，前端直接渲染。
>
> `timeline` 按用户作息时间表（`settings.daySchedule`）逐时段展开、按 `start` 升序：
> `kind: "activity"` 是眼操 / 午餐 / 午休 / 大课间等固定事件；`kind: "lesson"` 合并
> 了当天该节次的排课（无排课时 `slotId` 等为 `null`）。`lessons` 仍保留供旧客户端使用。

---

## 6. 待办 Events

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/events` | Query：`from`、`to`、`classId`、`isDone`、分页 |
| POST | `/events` | `{ "title", "description", "startAt", "endAt", "allDay", "classId" }` |
| PATCH | `/events/{eventId}` | 更新，含 `{ "isDone": true }` 勾选完成 |
| DELETE | `/events/{eventId}` | `204` |

---

## 7. 座位图 Seating

### GET /classes/{classId}/seating-charts — 方案列表

响应：`[{ "id", "name", "rowCount", "colCount", "isActive", "assignedCount", "updatedAt" }]`

### POST /classes/{classId}/seating-charts — 新建方案

请求：

```json
{
  "name": "日常版", "rowCount": 6, "colCount": 8,
  "layout": { "podium": "top", "disabledCells": [[2, 3]], "aisles": { "afterCols": [3] } },
  "isActive": true
}
```

### GET /seating-charts/{chartId} — 方案详情（含座位分配）

```json
{
  "data": {
    "id": "sea_…", "classId": "cls_…", "name": "日常版",
    "rowCount": 6, "colCount": 8,
    "layout": { "podium": "top", "disabledCells": [[2, 3]] },
    "isActive": true,
    "assignments": [{
      "studentId": "stu_…", "studentName": "张三", "studentNo": "01",
      "gender": "male", "rowIndex": 0, "colIndex": 0, "isPinned": false
    }],
    "unassignedStudents": [{ "id": "stu_…", "name": "李四", "studentNo": "02" }]
  }
}
```

### PATCH /seating-charts/{chartId} — 更新方案元信息（改名、尺寸、`isActive`）

> 缩小尺寸导致已有座位越界 → `422 BUSINESS_RULE_VIOLATION`，`details` 列出越界学生。

### PUT /seating-charts/{chartId}/assignments — 全量保存座位分配

请求：

```json
{
  "assignments": [
    { "studentId": "stu_a", "rowIndex": 0, "colIndex": 0, "isPinned": true },
    { "studentId": "stu_b", "rowIndex": 0, "colIndex": 1, "isPinned": false }
  ]
}
```

响应 `200`：返回更新后的方案详情。
校验：座位不重复、不落在 `disabledCells`、不越界、学生属于该班；违反 → `422`。

### POST /seating-charts/{chartId}/randomize — 随机排座

请求：

```json
{
  "keepPinned": true,
  "frontRowTagIds": ["tag_需关注"],
  "avoidSameGenderAdjacent": false,
  "persist": false
}
```

响应 `200`：`{ "data": { "assignments": [ … ] } }`
`persist: false` 时仅返回预览结果，前端确认后再调 `PUT …/assignments` 保存。
可用座位数 < 待排学生数 → `422`，`message` 说明缺口数量。

### DELETE /seating-charts/{chartId} → `204`

---

## 8. 课堂工具 Tools

### POST /classes/{classId}/lottery/draw — 随机抽签

请求：

```json
{
  "count": 1,
  "mode": "noRepeat",
  "excludeStudentIds": ["stu_x"],
  "tagIds": [],
  "record": true
}
```

`mode`：`plain`（纯随机）｜`noRepeat`（本轮不重复）｜`weighted`（按历史次数降权）

响应 `200`：

```json
{
  "data": {
    "students": [{ "id": "stu_…", "name": "张三", "studentNo": "01", "avatarUrl": null }],
    "roundRemaining": 47,
    "roundReset": false
  }
}
```

`noRepeat` 模式抽完全班后自动重置，`roundReset: true` 提示前端。

### POST /classes/{classId}/lottery/reset — 重置不重复轮次 → `204`

### GET /classes/{classId}/lottery/records — 抽签历史

Query：`from`、`to`、分页。响应含每个学生被抽中次数的汇总：

```json
{
  "data": [{ "id": "lot_…", "studentId": "stu_…", "studentName": "张三", "mode": "noRepeat", "createdAt": "…" }],
  "meta": { "page": 1, "pageSize": 20, "total": 96, "totalPages": 5 },
  "summary": [{ "studentId": "stu_…", "studentName": "张三", "count": 4 }]
}
```

---

### POST /classes/{classId}/grouping/generate — 生成分组

请求：

```json
{
  "mode": "byGroupCount",
  "groupCount": 6,
  "groupSize": null,
  "includeStudentIds": null,
  "excludeStudentIds": ["stu_x"],
  "balanceGender": true,
  "balanceByExamId": "exm_…",
  "separatePairs": [["stu_a", "stu_b"]],
  "persist": false
}
```

`mode`：`byGroupCount`（指定组数）｜`byGroupSize`（指定每组人数）。二者互斥。

响应 `200`：

```json
{
  "data": {
    "planId": null,
    "groups": [{
      "groupIndex": 1, "name": "第1组",
      "members": [{ "id": "stu_…", "name": "张三", "gender": "male", "score": 88 }],
      "avgScore": 79.5
    }]
  }
}
```

`persist: true` 时保存为方案并返回 `planId`。
约束无法同时满足（如 `separatePairs` 冲突）→ `422`，`message` 指明冲突的学生对。

### GET /classes/{classId}/grouping/plans — 已保存分组方案列表
### GET /grouping-plans/{planId} — 方案详情
### DELETE /grouping-plans/{planId} → `204`

---

## 9. 考试 Exams

一次考试（考试批次，`exam_sessions`，如「第一次月考」）可包含多个科目，每个科目是一条
`exams` 记录，独立录入成绩、独立统计（`stats_cache`）。`exam_sessions` 只承载
名称/类型/日期/备注这些共享属性；科目的增删、满分、成绩录入都作用在 `exams` 记录上。

### GET /classes/{classId}/exam-sessions — 考试列表（按批次分组）

Query：`examType`、`from`、`to`、分页

响应：

```json
{
  "data": [{
    "id": "exs_…", "classId": "cls_…", "name": "第一次月考",
    "examType": "midterm", "examDate": "2026-09-25", "note": "",
    "exams": [
      {
        "id": "exm_…", "classId": "cls_…", "examSessionId": "exs_…",
        "name": "第一次月考", "subject": "语文", "examType": "midterm",
        "examDate": "2026-09-25", "fullScore": 120, "note": "",
        "entryProgress": { "entered": 46, "total": 48 },
        "stats": { "avg": 78.4, "max": 98, "min": 41, "passRate": 0.875 }
      },
      { "id": "exm_…", "subject": "数学", "fullScore": 150, "…": "…" }
    ]
  }],
  "meta": { "page": 1, "pageSize": 20, "total": 6, "totalPages": 1 }
}
```

### POST /classes/{classId}/exam-sessions — 新建考试（一次创建多个科目）

```json
{
  "name": "第一次月考", "examType": "midterm", "examDate": "2026-09-25", "note": "",
  "subjects": [
    { "subject": "语文", "fullScore": 120 },
    { "subject": "数学", "fullScore": 150 },
    { "subject": "英语", "fullScore": 120 }
  ]
}
```

`subjects` 至少 1 项；每项生成一条 `exams` 记录，`name`/`examType`/`examDate` 继承自批次。

### GET /exam-sessions/{examSessionId} / PATCH /exam-sessions/{examSessionId} / DELETE /exam-sessions/{examSessionId}

PATCH 只接受 `name`/`examType`/`examDate`/`note`；改动 `name`/`examType`/`examDate` 会级联更新到该批次下所有科目的
`exams` 记录（它们冗余存了这几个字段，供成绩录入/分析按单个 `examId` 查询而不必联查批次）。
DELETE 级联软删除批次下所有科目及其成绩。

### POST /exam-sessions/{examSessionId}/exams — 给已有考试批次添加一个科目
`{ "subject": "英语", "fullScore": 120, "note": "" }`

### GET /classes/{classId}/exams — 考试列表（按科目，扁平）

供分析页（按单个 `examId` 查询）和分组工具（「按上次考试成绩均衡分组」）使用，形状与旧版一致，
不再需要即可按批次分组查看。Query：`subject`、`examType`、`from`、`to`、分页。

### GET /exams/{examId}

### PATCH /exams/{examId} — 编辑单个科目

只接受 `subject`/`fullScore`/`note`；考试名称/类型/日期请通过 PATCH `/exam-sessions/{id}` 修改。

### DELETE /exams/{examId} — 删除单个科目

删除该科目及其成绩。若这是该批次最后一个科目，返回 `422 BUSINESS_RULE_VIOLATION`
（请改用 `DELETE /exam-sessions/{id}` 删除整场考试）。

---

## 10. 成绩 Scores

### GET /exams/{examId}/scores — 成绩录入表

响应 `200`（返回全班学生，未录入的 `score` 为 `null`）：

```json
{
  "data": {
    "exam": { "id": "exm_…", "name": "第一次月考", "fullScore": 100, "subject": "数学" },
    "scores": [
      { "studentId": "stu_a", "studentName": "张三", "studentNo": "01", "score": 88, "isAbsent": false, "comment": "" },
      { "studentId": "stu_b", "studentName": "李四", "studentNo": "02", "score": null, "isAbsent": true, "comment": "病假" }
    ]
  }
}
```

### PUT /exams/{examId}/scores — 批量保存成绩

请求：

```json
{
  "scores": [
    { "studentId": "stu_a", "score": 88, "isAbsent": false },
    { "studentId": "stu_b", "score": null, "isAbsent": true, "comment": "病假" }
  ]
}
```

响应 `200`：`{ "data": { "saved": 2, "stats": { "avg": 88, "max": 88, "min": 88, "count": 1, "absent": 1 } } }`

语义：**upsert**，未出现在请求中的学生成绩保持不变。保存后重算并刷新 `exams.stats_cache`。
`score > fullScore` 或 `score < 0` → `400 VALIDATION_ERROR`。

### PATCH /exams/{examId}/scores/{studentId} — 单条更新（录入页实时保存用）

### GET /exams/{examId}/scores/template — 下载成绩导入模板

响应 `200`：`.xlsx` 文件，预填当前班级花名册（学号 / 姓名）及已录入的 分数 / 缺考。

### POST /exams/{examId}/scores/import-file — 上传成绩导入模板

请求：`multipart/form-data`，字段 `file` 为填好的 `.xlsx` 文件。按 学号 匹配学生，未填学号则按 姓名 回退匹配。

响应 `200`：`{ "data": { "matched": 2, "skipped": ["未知同学"], "scores": [{ "studentId": "stu_a", "score": 88, "isAbsent": false }] } }`

仅返回匹配结果，不落库——前端合并进当前录入表格后仍需调用 `PUT /exams/{examId}/scores` 保存。
`score > fullScore` → `400 VALIDATION_ERROR`；一个学生都未匹配到 → `400 VALIDATION_ERROR`。

---

## 11. 成绩分析 Analytics

### GET /analytics/class/{classId}/exam/{examId} — 单次考试班级分析

Query：`bucketSize`（分数分桶宽度，默认 10）

响应 `200`：

```json
{
  "data": {
    "exam": { "id": "exm_…", "name": "第一次月考", "subject": "数学", "examDate": "2026-09-25", "fullScore": 100 },
    "summary": {
      "total": 48, "attended": 46, "absent": 2,
      "avg": 78.4, "max": 98, "min": 41, "median": 80,
      "stddev": 12.3, "passRate": 0.875, "excellentRate": 0.229
    },
    "distribution": [
      { "range": "0-59", "label": "不及格", "count": 6, "ratio": 0.13 },
      { "range": "60-69", "count": 8, "ratio": 0.174 },
      { "range": "70-79", "count": 12, "ratio": 0.261 },
      { "range": "80-89", "count": 13, "ratio": 0.283 },
      { "range": "90-100", "count": 7, "ratio": 0.152 }
    ],
    "gradeRatio": [
      { "grade": "excellent", "label": "优秀", "count": 11, "ratio": 0.239 },
      { "grade": "good", "label": "良好", "count": 14, "ratio": 0.304 },
      { "grade": "fair", "label": "中等", "count": 15, "ratio": 0.326 },
      { "grade": "poor", "label": "待提升", "count": 6, "ratio": 0.131 }
    ],
    "ranking": [{
      "rank": 1, "studentId": "stu_…", "studentName": "王五", "studentNo": "12",
      "score": 98, "previousRank": 3, "rankDelta": 2
    }]
  }
}
```

### GET /analytics/class/{classId}/trend — 班级多次考试趋势

Query：`subject`、`examType`、`from`、`to`、`limit`（默认 20）

```json
{
  "data": {
    "series": [{
      "examId": "exm_…", "examName": "第一次月考", "examDate": "2026-09-25",
      "avg": 78.4, "max": 98, "min": 41, "median": 80,
      "passRate": 0.875, "excellentRate": 0.229, "attended": 46
    }]
  }
}
```

### GET /analytics/class/compare — 多班级同场考试对比

Query：`classIds`（逗号分隔，必填）、`examName` 或 `examDate`、`subject`

```json
{
  "data": {
    "examName": "第一次月考", "subject": "数学",
    "classes": [
      { "classId": "cls_1", "className": "高二(3)班", "avg": 78.4, "passRate": 0.875, "attended": 46 },
      { "classId": "cls_2", "className": "高二(5)班", "avg": 81.2, "passRate": 0.913, "attended": 45 }
    ]
  }
}
```

### GET /analytics/student/{studentId} — 学生维度分析

Query：`subject`（可选，限定科目）、`limit`（默认 20）

```json
{
  "data": {
    "student": { "id": "stu_…", "name": "张三", "studentNo": "01", "className": "高二(3)班" },
    "summary": {
      "examCount": 6, "avgScore": 82.3, "bestScore": 94, "worstScore": 68,
      "avgRank": 12, "bestRank": 5, "stddev": 8.1
    },
    "trend": [{
      "examId": "exm_…", "examName": "第一次月考", "examDate": "2026-09-25",
      "subject": "数学", "score": 88, "fullScore": 100,
      "classAvg": 78.4, "rank": 8, "totalStudents": 46, "zScore": 0.78
    }],
    "subjectRadar": [
      { "subject": "数学", "score": 88, "classAvg": 78.4, "zScore": 0.78 },
      { "subject": "物理", "score": 76, "classAvg": 72.1, "zScore": 0.35 }
    ]
  }
}
```

> 该生仅 1 次考试时 `trend` 返回单元素数组，`stddev` 为 `0`，前端正常渲染单点。

---

## 12. 导出 Export

### GET /exports/class/{classId}/scores — 导出班级成绩单

Query：`format`（`csv` | `xlsx`，默认 `csv`）、`examIds`（逗号分隔，缺省为全部）

响应 `200`：二进制文件流
`Content-Disposition: attachment; filename="高二3班-成绩单-20260830.csv"`

### GET /exports/class/{classId}/students — 导出学生名册（同上参数）

---

## 13. 文件上传 Uploads

### POST /uploads/avatar — 上传头像

请求：`multipart/form-data`，字段 `file`
限制：JPEG / PNG / WebP，≤ 2 MB，服务端裁剪为 256×256

响应 `201`：`{ "data": { "url": "https://cdn.teacherdesk.app/avatars/…jpg" } }`
超限 → `400 VALIDATION_ERROR`（`FILE_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE`）

---

## 13.1 推送提醒 Push

课程 / 待办开始前的 Web Push 提醒。后端在进程内每分钟扫描一次即将开始的课程与
未完成的定时待办，命中 `[now, now + 提前分钟数]` 窗口即向该用户所有已订阅设备推送一
条通知；去重记录写入 `sent_reminders`，进程重启或扫描重叠都不会重复。

提前分钟数与总开关存在 `PATCH /auth/me` 的 `settings` 中：
`{ "pushRemindersEnabled": true, "remindBeforeMinutes": 5 }`（`remindBeforeMinutes` 取值 1–120）。

课程提醒的触发时刻按 `settings.timeZone`（IANA 时区名，如 `"Asia/Shanghai"`）把作息表
的钟表时间换算成真实时刻——本应用面向公众，教师可能身处任意时区，因此这是**按用户**
存储的，而非服务端全局配置。未设置时回退到服务端环境变量 `LOCAL_TZ_OFFSET_MINUTES`
（默认 UTC+8），仅作为兼容旧数据的兜底，不代表所有用户都在同一时区。前端在首次开启
推送时会用浏览器的 `Intl.DateTimeFormat().resolvedOptions().timeZone` 自动写入。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/push/vapid-public-key` | `{ "data": { "key": "<VAPID 公钥或 null>", "enabled": <服务端是否配置了 VAPID> } }` |
| POST | `/push/subscriptions` | `{ "endpoint", "keys": { "p256dh", "auth" } }`，按 `endpoint` upsert，幂等 → `201` |
| DELETE | `/push/subscriptions` | Body `{ "endpoint" }`，注销该设备订阅 → `204` |
| POST | `/push/test` | 向当前用户所有设备发送一条测试通知，返回 `{ "data": { "delivered": <条数> } }` |

未配置 VAPID 时，`enabled` 为 `false`，其余接口仍可调用但不会实际下发通知。

投递说明：`sendNotification` 带 `TTL: 3600`；返回 `404/410` 视为订阅失效，删除该行；
其余错误（如 VAPID 密钥轮换后的 `403`）记 `warn` 日志。前端 `subscribeAndRegister`
会比对已有订阅的 `applicationServerKey` 与服务端公钥，不一致时自动退订并重新订阅
（这是「换了 VAPID 密钥后推送全废」的常见原因）。

---

## 13.2 设备管理 Devices

列出并管理当前账号关联的设备。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/devices` | `{ "data": { "pushEnabled", "subscriptions": [{ id, label, userAgent, createdAt, lastSeenAt }], "sessions": [{ id, deviceInfo, createdAt, expiresAt }] } }`。不返回推送 endpoint / 密钥 / token 哈希。 |
| DELETE | `/devices/subscriptions/{id}` | 移除一条推送订阅 → `204`。他人订阅 → `403`。 |
| DELETE | `/devices/sessions/{id}` | 吊销一个登录会话（refresh token）→ `204`。该设备下次请求返回 `401`。 |

`sessions` 里的 `id` 与登录 / 刷新响应新增的 `sessionId` 对应，前端据此标记「本机」。

## 13.3 天气 Weather

首页天气卡片的数据代理。数据源 Open-Meteo（免费、无需 Key）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/weather?lat=&lon=` | `lat ∈ [-90,90]`、`lon ∈ [-180,180]`。返回今明两天预报。 |

响应：`{ "data": { "current": { temp, weatherCode, text, windSpeed }, "days": [{ date, weatherCode, text, tempMax, tempMin, precipProb }] } }`。
上游不可达 / 超时 → `{ "data": null }`（不返回 5xx，前端静默隐藏卡片）。
同一坐标 30 分钟内进程内缓存。

---

## 14. 健康检查

### GET /health → `200 { "status": "ok", "version": "1.0.0", "time": "…" }`（无需鉴权）

---

## 附录 A：接口索引

| 模块 | 方法与路径 |
|---|---|
| Auth | `POST /auth/register`、`POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout`、`GET /auth/me`、`PATCH /auth/me`、`POST /auth/change-password` |
| Classes | `GET /classes`、`POST /classes`、`GET|PATCH|DELETE /classes/{id}` |
| Students | `GET|POST /classes/{id}/students`、`POST /classes/{id}/students/bulk-import`、`GET /classes/{id}/students/import-template`、`POST /classes/{id}/students/import-file`、`PATCH /classes/{id}/students/batch`、`GET|PATCH|DELETE /students/{id}` |
| Tags | `GET|POST /tags`、`PATCH|DELETE /tags/{id}` |
| Schedule | `GET|POST /schedule/slots`、`PATCH|DELETE /schedule/slots/{id}`、`GET /schedule/agenda` |
| Events | `GET|POST /events`、`PATCH|DELETE /events/{id}` |
| Seating | `GET|POST /classes/{id}/seating-charts`、`GET|PATCH|DELETE /seating-charts/{id}`、`PUT /seating-charts/{id}/assignments`、`POST /seating-charts/{id}/randomize` |
| Tools | `POST /classes/{id}/lottery/draw`、`POST /classes/{id}/lottery/reset`、`GET /classes/{id}/lottery/records`、`POST /classes/{id}/grouping/generate`、`GET /classes/{id}/grouping/plans`、`GET|DELETE /grouping-plans/{id}` |
| Exams | `GET|POST /classes/{id}/exam-sessions`、`GET|PATCH|DELETE /exam-sessions/{id}`、`POST /exam-sessions/{id}/exams`、`GET /classes/{id}/exams`（扁平）、`GET|PATCH|DELETE /exams/{id}` |
| Scores | `GET|PUT /exams/{id}/scores`、`PATCH /exams/{id}/scores/{studentId}`、`GET /exams/{id}/scores/template`、`POST /exams/{id}/scores/import-file` |
| Analytics | `GET /analytics/class/{id}/exam/{examId}`、`GET /analytics/class/{id}/trend`、`GET /analytics/class/compare`、`GET /analytics/student/{id}` |
| Export | `GET /exports/class/{id}/scores`、`GET /exports/class/{id}/students` |
| Upload | `POST /uploads/avatar` |
| Push | `GET /push/vapid-public-key`、`POST|DELETE /push/subscriptions`、`POST /push/test` |
| Devices | `GET /devices`、`DELETE /devices/subscriptions/{id}`、`DELETE /devices/sessions/{id}` |
| Weather | `GET /weather` |
| Health | `GET /health` |

## 附录 B：前端离线缓存策略（PWA）

Service Worker 的运行时缓存**只按 URL 存储，不区分账号**。学生姓名、家长电话、
成绩属于个人信息，因此缓存策略以隐私优先：

| 接口 | 策略 | 说明 |
|---|---|---|
| `/auth/*` | **NetworkOnly** | 绝不缓存；缓存的 `/auth/me` 会把上一位教师的身份交给下一位 |
| `/classes`、`/students`、`/tags`、`/schedule`、`/events`、`/seating-charts` | **NetworkFirst**，TTL 12 小时 | 有网时永远以服务端为准，仅断网时回落缓存（AC-16） |
| `/analytics/*` | **NetworkOnly** | 派生数据，重算成本低、离线价值小，不落盘 |
| 所有写操作（POST/PUT/PATCH/DELETE） | 不缓存 | 离线时前端拦截并提示，不入队（v1） |

**不使用 StaleWhileRevalidate**：该策略会先返回缓存再后台更新，在同一浏览器
切换账号时可能把上一位教师的学生名单直接渲染出来。

**缓存清理时机**（前端 `purgeApiCaches()`，见 `web/src/api/client.ts`）：

- 登出时
- 登录 / 注册时（上一次会话可能因崩溃、关标签页而未正常登出）
- 修改密码后（服务端已吊销全部 token）
- Refresh Token 失效、被动登出时

所有运行时缓存以 `td-` 前缀命名，清理逻辑据此匹配；新增缓存请沿用该前缀。

> 实现说明：为支持 Web Push，Service Worker 改为 `injectManifest` 策略，源码在
> `web/src/sw.ts`。上表的运行时缓存规则从 `vite.config.ts` 平移到该文件，**策略与
> 隐私约束完全不变**；`sw.ts` 额外处理 `push` 与 `notificationclick` 事件。
