// @aiproj/backend — TenantScopeService（v3-multitenant-isolation-architecture §3.4）。
//
// 租户 scoped read/write 助手（design Decision 1：应用层 Tenant Boundary）：
// - requireTenant：从 HttpContext 解析完整 TenantContext，缺失即 fail closed
// - scopedQuery：按 registry 声明的归属字段附加组织（及可选项目）where
// - findInScopeOrFail：scope 内查找，跨租户统一 404 掩蔽
// - assertSameTenant / assertBatchSameTenant：混租引用/批处理拒绝，不泄露目标存在性
// - assertGlobalAllowed：super admin 全局操作必须经 registry 显式声明
//
// 使用 registry 的 organizationField/projectField（DB snake_case），不硬编码字段名。

import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import {
  isBatchSameTenant,
  type MultitenantResourceType,
  type TenantContext as SharedTenantContext,
} from '@aiproj/types/multitenant-isolation-architecture'
import TenantScopeRegistry from './tenant_scope_registry.js'

/** 可做链式 where 的查询形状（兼容 Lucid ModelQueryBuilder 的最小接口，便于单测） */
interface WhereableQuery {
  where(column: string, value: unknown): unknown
}

/** 具备 first() 的查询形状 */
interface FirstableQuery extends WhereableQuery {
  first(): Promise<unknown>
}

/** 批量解析用的查询形状（Lucid ModelQueryBuilder 同时具备 whereIn/exec） */
interface BatchableQuery extends WhereableQuery {
  whereIn(column: string, values: Array<number | string>): unknown
  exec(): Promise<unknown[]>
}

/** 可被 findInScopeOrFail 接收的模型形状 */
interface TenantScopedModel {
  query(): FirstableQuery
}

/** 可被 assertBatchInScope 接收的模型形状 */
interface TenantBatchModel {
  query(): BatchableQuery
}

const ORG_FIELD_CAMEL = 'organizationId'
const ORG_FIELD_SNAKE = 'organization_id'

/**
 * 从任意行取值（兼容 Lucid 行对象 camelCase 与原始 snake_case）。
 */
function readOrganizationId(row: Record<string, unknown>): number | null {
  const v = row[ORG_FIELD_CAMEL] ?? row[ORG_FIELD_SNAKE]
  return v === undefined || v === null ? null : Number(v)
}

export default class TenantScopeService {
  /**
   * 从 HttpContext 解析完整租户上下文。
   * 缺失 tenant 时抛 PERMISSION_DENIED（fail closed，与 RBAC middleware 语义一致）。
   */
  requireTenant(ctx: HttpContext): SharedTenantContext {
    const tenant = ctx.tenant
    if (!tenant) {
      throw new PermissionDeniedException('需要组织上下文')
    }
    return {
      organizationId: tenant.organizationId,
      projectId: tenant.projectId ?? null,
      scopeMode: tenant.scopeMode ?? 'organization_scoped',
      actorRef: tenant.actorRef ?? `user:${ctx.authUser?.id ?? 'unknown'}`,
      isSuperAdmin: tenant.isSuperAdmin ?? false,
    }
  }

  /**
   * 解析写入/预览/导出可用的组织 ID（v3-multitenant-isolation-architecture §4.2，
   * design Decision 3：写入 scope 只来自服务端解析的租户上下文）。
   *
   * - 非 super admin 且无租户上下文 → PERMISSION_DENIED（fail closed）
   * - 非 super admin：以 `ctx.tenant.organizationId` 为事实源；客户端 body/query 传来的
   *   organizationId 仅作一致性校验，不一致统一 RESOURCE_NOT_FOUND（不泄露目标存在性）。
   *   query string 不经 tenant middleware 的 body 一致性校验，因此此处是 query 侧的唯一门。
   * - super admin：允许显式指定组织作为 scope 选择（system_global 模式），未指定时回落
   *   租户上下文，仍无则返回 null（保留既有全局语义；全局能力本身仍须 registry 显式声明）
   */
  resolveOrganizationId(ctx: HttpContext, clientOrganizationId?: number | null): number | null {
    const tenant = ctx.tenant
    const isSuperAdmin = Boolean(tenant?.isSuperAdmin ?? ctx.authUser?.isSuperAdmin)
    const claimed =
      clientOrganizationId === undefined || clientOrganizationId === null
        ? null
        : Number(clientOrganizationId)

    if (claimed !== null && (!Number.isFinite(claimed) || claimed <= 0)) {
      throw new ResourceNotFoundException('资源不存在')
    }

    if (isSuperAdmin) {
      return claimed ?? tenant?.organizationId ?? null
    }

    if (!tenant) {
      throw new PermissionDeniedException('需要组织上下文')
    }
    if (claimed !== null && claimed !== tenant.organizationId) {
      throw new ResourceNotFoundException('资源不存在')
    }
    return tenant.organizationId
  }

  /**
   * `resolveOrganizationId` 的必选变体：解析结果为 null（super admin 无任何组织 scope）
   * 时抛 PERMISSION_DENIED，供必须落到具体组织的写入/作业路径使用。
   */
  requireOrganizationId(ctx: HttpContext, clientOrganizationId?: number | null): number {
    const organizationId = this.resolveOrganizationId(ctx, clientOrganizationId)
    if (organizationId === null) {
      throw new PermissionDeniedException('需要组织上下文')
    }
    return organizationId
  }

  /**
   * 混租引用校验（§4.3）：一次性校验 update/preview/confirm 请求中引用的多类资源
   * （project/task/member/file/report/source attribution/compiler artifact/
   * KMS/DLP/watermark/compliance 等）全部属于当前租户。
   *
   * 任一引用跨租户或不存在 → 整体拒绝（registry 的 errorSemantics 决定错误形态），
   * 不指明是哪个引用越界，且在任何写入之前完成（无部分变更）。
   */
  async assertReferencesInScope(
    references: Array<{
      model: TenantScopedModel
      id: number | string | null | undefined
      resourceType: MultitenantResourceType
      projectId?: number | null
    }>,
    organizationId: number,
  ): Promise<void> {
    for (const ref of references) {
      if (ref.id === null || ref.id === undefined) {
        continue
      }
      const decl = TenantScopeRegistry.get(ref.resourceType)
      try {
        await this.findInScopeOrFail(ref.model, ref.id, {
          organizationId,
          projectId: ref.projectId ?? null,
          resourceType: ref.resourceType,
        })
      } catch {
        throw this.denialFor(decl.errorSemantics)
      }
    }
  }

  /**
   * 按 registry 声明的归属字段附加组织（及可选项目）过滤。
   * 有直接组织列的资源按 organizationField 过滤；项目派生资源（organizationField=null，
   * 如 task/wbs/member/file/report）必须提供 projectId，按 projectField 过滤，
   * 否则 fail closed（不产生无租户条件的全表查询）。
   * 计数/聚合/hash/preload 必须在该过滤之后执行（调用方保证）。
   */
  scopedQuery<Q extends WhereableQuery>(
    query: Q,
    params: {
      organizationId: number
      projectId?: number | null
      resourceType?: MultitenantResourceType
    },
  ): Q {
    const decl = TenantScopeRegistry.get(params.resourceType ?? 'project')
    if (decl.organizationField && decl.organizationField.length > 0) {
      let q = query.where(decl.organizationField, params.organizationId) as unknown as Q
      if (typeof params.projectId === 'number' && decl.projectField) {
        q = q.where(decl.projectField, params.projectId) as unknown as Q
      }
      return q
    }
    if (typeof params.projectId !== 'number' || !decl.projectField) {
      throw new PermissionDeniedException('项目派生资源缺少项目上下文')
    }
    return query.where(decl.projectField, params.projectId) as unknown as Q
  }

  /**
   * scope 内按主键查找；行缺失（含跨租户）统一抛 RESOURCE_NOT_FOUND，不泄露存在性。
   * 项目派生资源（organizationField=null）必须提供 projectId，按 projectField 过滤，
   * 否则 fail closed。
   */
  async findInScopeOrFail<T>(
    model: TenantScopedModel,
    id: number | string,
    params: {
      organizationId: number
      projectId?: number | null
      resourceType?: MultitenantResourceType
    },
  ): Promise<T> {
    const decl = TenantScopeRegistry.get(params.resourceType ?? 'project')
    let query = model.query() as unknown as FirstableQuery
    query = query.where('id', id) as unknown as FirstableQuery
    if (decl.organizationField && decl.organizationField.length > 0) {
      query = query.where(
        decl.organizationField,
        params.organizationId,
      ) as unknown as FirstableQuery
      const scoped =
        typeof params.projectId === 'number' && decl.projectField
          ? (query.where(decl.projectField, params.projectId) as unknown as FirstableQuery)
          : query
      const row = await scoped.first()
      return this.rowOrNotFound<T>(row)
    }
    if (typeof params.projectId !== 'number' || !decl.projectField) {
      throw new PermissionDeniedException('项目派生资源缺少项目上下文')
    }
    query = query.where(decl.projectField, params.projectId) as unknown as FirstableQuery
    const row = await query.first()
    return this.rowOrNotFound<T>(row)
  }

  /** 空结果统一 404 掩蔽（不泄露目标存在性）。 */
  private rowOrNotFound<T>(row: unknown): T {
    if (!row) {
      throw new ResourceNotFoundException('资源不存在')
    }
    return row as T
  }

  /**
   * 校验一组已加载行全部属于当前组织；任一跨租户即整体拒绝（不泄露具体行/来源）。
   */
  assertSameTenant(
    rows: Array<Record<string, unknown>>,
    organizationId: number,
    reasonCode: string = 'MIXED_TENANT_REFERENCE',
  ): void {
    for (const row of rows) {
      const owner = readOrganizationId(row)
      if (owner !== null && owner !== organizationId) {
        throw this.denialFor(reasonCode)
      }
    }
  }

  /**
   * 批量输入在各 ref 已解析出 owner organization id 后统一判同租户；
   * 混租即整体拒绝（MIXED_TENANT_BATCH，不泄露是哪个 ID 属于他租）。
   */
  assertBatchSameTenant(
    resolvedOwners: Array<number | string>,
    currentOrganizationId: number,
  ): void {
    const verdict = isBatchSameTenant({
      currentOrganizationId,
      resolvedOwners,
    })
    if (verdict.decision !== 'allow') {
      throw this.denialFor('MIXED_TENANT_BATCH')
    }
  }

  /**
   * 批量输入的租户 scope 一次性解析（§5.1，spec「Batch operations MUST prevent
   * mixed-tenant payloads」）。
   *
   * 必须在**预览生成、source hash 计算、后台调度与任何写入之前**调用：
   * 把客户端提交的一批 ID 放进 registry 声明的 scope 查询里解析，去重后数量不匹配
   * 即整体拒绝。跨租户 ID 与不存在的 ID 走同一条拒绝路径，调用方无法据错误区分，
   * 因此响应不泄露隐藏资源的存在性、标签、计数或归属组织（对应
   * 「Partial success does not leak hidden IDs」场景）。
   *
   * 返回 scope 内解析出的行，供调用方直接用于后续派生值计算——**不要**再回头用
   * 原始客户端 ID 列表算 count/hash，那会把被拒 ID 计入派生值。
   */
  async assertBatchInScope<T>(
    model: TenantBatchModel,
    ids: Array<number | string>,
    params: {
      organizationId: number
      projectId?: number | null
      resourceType?: MultitenantResourceType
    },
  ): Promise<T[]> {
    const unique = Array.from(new Set(ids.map((v) => String(v))))
    if (unique.length === 0) {
      return []
    }
    const decl = TenantScopeRegistry.get(params.resourceType ?? 'project')
    // 经 scopedQuery 走 registry 字段，派生资源缺 projectId 时在此 fail closed。
    const scoped = this.scopedQuery(model.query(), params) as unknown as BatchableQuery
    const rows = (await (scoped.whereIn('id', unique) as unknown as BatchableQuery).exec()) as T[]
    if (rows.length !== unique.length) {
      throw this.denialFor(decl.errorSemantics)
    }
    return rows
  }

  /**
   * super admin 全局操作门禁：registry 未显式允许即拒绝。
   */
  assertGlobalAllowed(resourceType: MultitenantResourceType): void {
    TenantScopeRegistry.assertGlobalAllowed(resourceType)
  }

  /**
   * reason code -> 非泄露异常（'RESOURCE_NOT_FOUND' 语义与 READ 路径对齐；
   * 其余按 PERMISSION_DENIED。细节不写入 message，避免侧信道）。
   */
  private denialFor(reasonCode: string): PermissionDeniedException | ResourceNotFoundException {
    if (reasonCode === 'RESOURCE_NOT_FOUND') {
      return new ResourceNotFoundException('资源不存在')
    }
    return new PermissionDeniedException('操作被拒绝')
  }
}
