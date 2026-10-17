/**
 * 组织套餐层级（plan policy 的唯一取值来源；数据库列 `organizations.plan_tier` 无 CHECK 约束，
 * 本型别是前后端对该字段的权威契约）。
 *
 * - `free`：个人免费工作区（本地注册 / Google 个人自助注册默认档）。**不授予企业能力权限**——
 *   后端 `RbacService.resolveOrganizationPermissions` 对 free 组织剥离
 *   `ENTERPRISE_PERMISSIONS`（SSO/KMS/DLP/水印/合规/多租户控制台/AI 质量成本控制台/
 *   发布信任/插件目录与策略管理等，见 `apps/backend/start/rbac/roles.ts`）；
 *   org_admin 基础能力（用户/邀请/组织设置/审计/项目等）保留。
 * - `team` / `enterprise`：付费档——授予完整 ORG_ADMIN 权限集。
 *
 * 会话侧配套：JWT claims 与 `/api/v1/account/profile` 返回体的 `planTier` 取
 * 用户当前生效组织的档位（无组织为 null），前端据此区分「个人免费组织」与「企业组织」。
 */
export type PlanTier = 'free' | 'team' | 'enterprise'
