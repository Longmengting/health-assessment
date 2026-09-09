# Health Path — 健康测评系统

[![CI](https://github.com/Longmengting/health-assessment/actions/workflows/ci.yml/badge.svg)](https://github.com/Longmengting/health-assessment/actions/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)
![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18)

一个可本地完整运行的健康测评应用：匿名会话 → 四步增量作答 → 刷新恢复 → 服务端计算 → 结果权限隔离 → 幂等模拟支付解锁。

> 所有结果仅用于教育参考，不构成医疗建议。

## ✨ 核心亮点

| 能力 | 实现方式 |
| --- | --- |
| 🔒 **匿名安全会话** | 服务端只存 token 哈希，访问凭证放 HttpOnly Cookie，数据库泄露也无法伪造会话 |
| 📝 **可恢复的分步作答** | 每步增量保存 + 版本号乐观锁，支持乱序拒绝、并发冲突检测，刷新页面进度不丢 |
| 🧮 **服务端可信计算** | BMI / BMR / TDEE / 目标日期算法全部在服务端，Zod 严格校验输入，结果记录算法版本 |
| 🛡️ **字段级权限隔离** | 非会员响应不泄露任何受保护字段（热量、曲线等），订阅过期自动降级为预览 |
| 💳 **幂等模拟支付** | Bearer 密钥 + `eventId` 唯一约束 + 事务，回调可安全重放，事件冲突返回 409 |
| ✅ **TDD 全流程** | 红 → 绿 → 重构，单元 + 数据库集成双测试，CI 每次推送自动跑 lint / typecheck / test / build |

## 🗺️ 代码导览（给评审者）

```
src/
  app/api/          # 路由层：契约解析、错误响应统一格式
  app/pay/          # 模拟支付回调入口
  features/
    assessment/     # 业务核心：会话、作答、计算、结果权限
    payment/        # 支付事件、订阅状态机
  lib/              # 共享基础设施
prisma/             # Schema 与迁移（含测试库分离）
tests/
  unit/             # 算法边界、非法输入
  integration/      # 并发、幂等、权限、支付闭环（真实 PostgreSQL）
```

## 🚀 快速开始

要求：Node.js 22、npm、Docker Desktop。

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d
npx prisma generate
npx prisma migrate deploy
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/health_path_test"
npx prisma migrate deploy
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/health_path_development"
npm run dev
```

浏览器打开 `http://localhost:3000`。首次启动 Docker 数据卷时会同时创建开发库 `health_path_development` 和独立测试库 `health_path_test`。

若以前创建过同名 Docker 数据卷但没有测试库，可先执行：

```powershell
docker compose exec postgres createdb -U postgres health_path_test
```

停止服务：`docker compose down`。默认不会删除数据库数据。

## 🖥️ 演示流程

1. 打开首页，完成性别、目标、身体数据、运动频率四步。
2. 每一步都会写入服务端；刷新页面后从 `localStorage` 中的 sessionId 恢复进度，访问凭证保存在 HttpOnly Cookie。
3. 提交后仅展示 BMI 与分类，受保护的热量、目标日期、变化速度和预测曲线不会返回给非会员。
4. 在结果页输入 `.env` 的 `MOCK_PAYMENT_SECRET`，点击 **Simulate payment and unlock**，即可模拟支付并解锁完整结果。

`.env.example` 的密钥只适用于本地演示，真实环境不得复用。

## 🧪 测试与质量保障

数据库集成测试只有在 `TEST_DATABASE_URL` 明确指向名称包含 `_test`、`-test`、`/test` 或 `test_` 的 PostgreSQL 数据库时才运行，防止误清空开发库。

```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/health_path_development"
$env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/health_path_test"
npm test
npm run typecheck
npm run lint
npm run build
```

主要覆盖：

- 算法：BMI、BMR/TDEE、热量建议、预测日期，以及年龄/身高/体重/目标方向的非法与边界输入。
- 保存恢复：中断恢复、乱序拒绝、重复提交幂等、乐观锁版本冲突与并发更新。
- 访问控制：无 Cookie/错误 Cookie 拒绝；非会员响应不包含任何受保护字段；有效会员返回完整结果；过期会员降级为预览。
- 支付：密钥验证、非法 payload、未完成测评拒绝、事件幂等、事件冲突、并发回调和支付前后 API 返回变化。
- 页面：关键入口、信任文案与免责声明存在。

CI（GitHub Actions）在每次推送和 PR 上自动执行 `lint → typecheck → test → build`。

暂未覆盖真实支付平台、邮件登录、浏览器自动化和性能压测，因为本作业使用匿名 session 与模拟支付，重点是后端业务闭环。

## 🔌 API

所有成功响应统一为 `{ data, meta: { requestId } }`，错误响应统一为 `{ error: { code, message, fields? }, meta }`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/sessions` | 创建匿名测评 session，并设置 HttpOnly Cookie |
| `GET` | `/api/sessions/:id` | 恢复版本、步骤、答案和完成进度 |
| `PUT` | `/api/sessions/:id/steps/:step` | 增量保存 `gender/goal/body/activity` |
| `POST` | `/api/sessions/:id/submit` | 完成计算并持久化结果，请求体必须为空 |
| `GET` | `/api/sessions/:id/result` | 按订阅状态返回预览或完整结果 |
| `POST` | `/pay` | 带服务端演示密钥的模拟支付回调（兼容路径） |
| `POST` | `/api/payments/mock` | 与 `/pay` 相同的规范路径 |

保存步骤示例（需要创建 session 时返回的 Cookie）：

```bash
curl -X PUT http://localhost:3000/api/sessions/SESSION_ID/steps/gender \
  -H "Content-Type: application/json" \
  -H "Cookie: hp_session_SESSION_ID=SESSION_TOKEN" \
  -d '{"data":{"gender":"female"},"expectedVersion":0}'
```

模拟支付可重放调用：

```bash
curl -X POST http://localhost:3000/pay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer demo-only-mock-payment-secret-change-me" \
  -d '{"eventId":"evt_demo_0001","sessionId":"SESSION_ID","status":"paid"}'
```

同一个 `eventId` 与同一 payload 重放会返回 `replayed: true`；复用 `eventId` 但更换内容会返回 `409 PAYMENT_EVENT_CONFLICT`。

## 🗄️ 数据库 Schema

```mermaid
erDiagram
  AssessmentSession ||--o{ AssessmentAnswer : has
  AssessmentSession ||--o| AssessmentResult : produces
  AssessmentSession ||--o| Subscription : owns
  AssessmentSession ||--o{ PaymentEvent : receives

  AssessmentSession {
    uuid id PK
    string tokenHash UK
    enum status
    int currentStep
    int version
    datetime completedAt
  }
  AssessmentAnswer {
    uuid id PK
    uuid sessionId FK
    string step
    json payload
    int revision
  }
  AssessmentResult {
    uuid id PK
    uuid sessionId FK_UK
    decimal bmi
    decimal dailyCalories
    string bmiCategory
    datetime estimatedTargetDate
    json protectedData
  }
  Subscription {
    uuid id PK
    uuid sessionId FK_UK
    enum status
    string provider
    string externalPaymentId
    datetime expiresAt
  }
  PaymentEvent {
    uuid id PK
    string eventId UK
    uuid sessionId FK
    enum status
    json payload
  }
```

设计要点：答案按步骤独立存储，新增步骤不需要扩展宽表；session 使用版本号做乐观并发控制；计算结果记录算法版本；订阅与支付事件分离，使支付回调可审计且幂等。

## 🤖 AI 使用复盘

AI 用于把题目拆成数据模型、契约、业务服务、路由和测试几个可验证层；辅助枚举非法输入、并发写入、重放回调、过期订阅和字段泄漏等边界；同时生成 Prisma 迁移草案与测试数据，再通过 TypeScript、数据库约束和自动化测试逐项验证。

一次明确否决的 AI 建议是：最初方案希望把模拟支付做成“客户端调用一个无鉴权 `/pay` 接口，直接把用户改为会员”。这虽然演示方便，但任何人都能替任意 session 解锁，也无法区分合法重放和冲突事件。因此最终保留服务端 Bearer 密钥、严格 payload 白名单、独立 `PaymentEvent.eventId` 唯一约束和事务处理；前端本地演示需要手动输入密钥，不把密钥打进客户端包。

另一个修正是测试辅助函数曾用 `undefined` 表达“无 Authorization 请求头”，但 JavaScript 默认参数把它替换成了正确密钥，使测试实际走到了成功分支。通过单独的 `null` 哨兵表达缺失请求头后，测试才真正验证了 401 路径。这说明 AI 生成的测试也必须先观察失败原因，而不能只看用例名称。

## 📌 范围说明

本版本定位为本地可运行的精简作业，未配置公网部署。仓库包含 CI、迁移、Docker 本地数据库、自动化测试与生产构建命令，评审者可以完整重放录入、恢复、计算、权限和模拟支付流程。
