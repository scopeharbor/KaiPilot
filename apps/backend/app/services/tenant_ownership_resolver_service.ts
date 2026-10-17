// @aiproj/backend — TenantOwnershipResolverService（v3-multitenant-tenant-identification §5）。
//
// spec「Resource ownership resolvers MUST derive tenant scope server-side」：当请求只带
// `projectId` / `taskId` / `fileId` 这类资源 ID、**没有**显式组织路由参数时，后端必须先
// 服务端反推该资源的候选组织，再与 effective tenant context 比对——比对发生在计数、
// 响应整形、预览生成、确认、导出、AI 上下文装配与任何写入**之前**。
//
// 与隔离执行层的分工：`TenantScopeService`（isolation）负责"查询时自动加 where
// organization_id"；本服务负责"这个 ID 到底属于谁"。前者保证查得出来的都在 scope 内，
// 后者回答"scope 外的 ID 该返回什么"——答案统一是非泄露 404（见 assertOwnedByTenant）。
//
// 两条归属形态（与 v3-multitenant-database-isolation 的表分类同源）：
//   - `direct`              资源行自带 organization_id（project / ai_draft / compiler_run / 各 ledger…）
//   - `derived_via_parent`  资源行只有父级外键，须再跳一跳（task/wbs/file/report → projects.organization_id；
//                           compiler_artifact / source_attribution → compiler_runs.organization_id）
//
// **刻意绕过 Lucid 模型**改用 query builder：多个模型挂了 `beforeFind`/`beforeFetch` 软删除
// 钩子甚至 scope 钩子，走模型查询会让"他组织的资源"与"不存在的资源"都返回 null——那正是
// resolver 需要区分的两件事（前者要判 mismatch 并审计，后者是普通 not found）。
// 对外响应仍然一致（都 404），区分只进低敏 reason 供排查。

import db from '@adonisjs/lucid/services/db'
import { inject } from '@adonisjs/core'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import TenantIdentificationAuditService from './tenant_identification_audit_service.js'
import type { MultitenantResourceType } from '@aiproj/types/multitenant-isolation-architecture'
import type {
  EffectiveTenantContext,
  TenantResolutionReason,
} from '@aiproj/types/multitenant-tenant-identification'

/** 归属解析形态。 */
export type TenantOwnershipKind = 'direct' | 'derived_via_parent' | 'unsupported'

export interface TenantOwnershipDescriptor {
  resourceType: MultitenantResourceType
  /** 资源表名。unsupported 时为 null。 */
  table: string | null
  kind: TenantOwnershipKind
  /** direct: 组织列名。derived: 父级外键列名。 */
  column: string | null
  /** derived 才有：父表与父表的组织列。 */
  parentTable?: string
  parentColumn?: string
  /**
   * unsupported 说明（为什么本 change 到不了这个资源）。
   * 存在即意味着**fail closed**：调用方必须拒绝，不得退回信任客户端提交的组织。
   */
  unsupportedReason?: string
}

/**
 * 归属解析登记表：覆盖 `MULTITENANT_RESOURCE_TYPES` 全部资源类型
 * （17 类多租户底座 + v3-sso-saml2 的 3 类 SSO 资源 = 20 类）。
 *
 * 全覆盖是刻意的——留白等于"忘了登记的资源默认可跨租户"，而 §5.5 的 inventory 测试
 * 正是靠"每类资源都必须显式登记 supported 或 unsupported"来挡住这种默认放行。
 */
const OWNERSHIP_REGISTRY: Record<MultitenantResourceType, TenantOwnershipDescriptor> = {
  organization: {
    resourceType: 'organization',
    table: 'organizations',
    kind: 'direct',
    // 组织自身的"归属组织"就是它自己的主键。
    column: 'id',
  },
  project: {
    resourceType: 'project',
    table: 'projects',
    kind: 'direct',
    column: 'organization_id',
  },
  task: {
    resourceType: 'task',
    table: 'tasks',
    kind: 'derived_via_parent',
    column: 'project_id',
    parentTable: 'projects',
    parentColumn: 'organization_id',
  },
  wbs: {
    resourceType: 'wbs',
    table: 'wbs_nodes',
    kind: 'derived_via_parent',
    column: 'project_id',
    parentTable: 'projects',
    parentColumn: 'organization_id',
  },
  member: {
    resourceType: 'member',
    table: 'organization_members',
    kind: 'direct',
    column: 'organization_id',
  },
  file: {
    resourceType: 'file',
    table: 'attachments',
    kind: 'derived_via_parent',
    column: 'project_id',
    parentTable: 'projects',
    parentColumn: 'organization_id',
  },
  report: {
    resourceType: 'report',
    table: 'reports',
    kind: 'derived_via_parent',
    column: 'project_id',
    parentTable: 'projects',
    parentColumn: 'organization_id',
  },
  audit: {
    resourceType: 'audit',
    table: 'audit_logs',
    kind: 'direct',
    column: 'organization_id',
  },
  ai_draft: {
    resourceType: 'ai_draft',
    table: 'ai_project_drafts',
    kind: 'direct',
    column: 'organization_id',
  },
  compiler_run: {
    resourceType: 'compiler_run',
    table: 'compiler_runs',
    kind: 'direct',
    column: 'organization_id',
  },
  compiler_artifact: {
    resourceType: 'compiler_artifact',
    table: 'compiler_artifacts',
    kind: 'direct',
    column: 'organization_id',
  },
  source_attribution: {
    resourceType: 'source_attribution',
    table: 'source_attributions',
    kind: 'direct',
    column: 'organization_id',
  },
  knowledge_item: {
    resourceType: 'knowledge_item',
    table: 'knowledge_items',
    kind: 'direct',
    column: 'organization_id',
  },
  // v3-plugin-private-registry-lifecycle §3：私有插件目录四表（均带直接组织列）。
  plugin_registry_entry: {
    resourceType: 'plugin_registry_entry',
    table: 'plugin_private_registry_entries',
    kind: 'direct',
    column: 'organization_id',
  },
  plugin_registry_release: {
    resourceType: 'plugin_registry_release',
    table: 'plugin_private_registry_releases',
    kind: 'direct',
    column: 'organization_id',
  },
  plugin_registry_review: {
    resourceType: 'plugin_registry_review',
    table: 'plugin_private_registry_reviews',
    kind: 'direct',
    column: 'organization_id',
  },
  plugin_registry_operation: {
    resourceType: 'plugin_registry_operation',
    table: 'plugin_private_registry_operations',
    kind: 'direct',
    column: 'organization_id',
  },
}

/** 归属解析结果（低敏：只含组织 ID 与枚举，不含资源名/计数）。 */
export interface TenantOwnershipResolution {
  resourceType: MultitenantResourceType
  /** 解析出的组织；资源不存在或不可解析时为 null。 */
  organizationId: number | null
  /** 资源行是否存在（用于区分 not-found 与 mismatch，只进低敏 reason）。 */
  found: boolean
  /** 是否与 effective tenant 匹配（未传入 effective scope 时为 null）。 */
  matches: boolean | null
  reason: TenantResolutionReason
}

@inject()
export default class TenantOwnershipResolverService {
  constructor(
    private readonly identificationAudit: TenantIdentificationAuditService = new TenantIdentificationAuditService(),
  ) {}

  /** 读取某资源类型的归属登记（供 §5.5 inventory 测试与调用方分派）。 */
  descriptorOf(resourceType: MultitenantResourceType): TenantOwnershipDescriptor {
    return OWNERSHIP_REGISTRY[resourceType]
  }

  /** 全量登记（inventory 测试用）。 */
  allDescriptors(): TenantOwnershipDescriptor[] {
    return Object.values(OWNERSHIP_REGISTRY)
  }

  /**
   * 服务端反推资源归属组织。
   *
   * 不抛异常——结果编码进 `reason`，由调用方决定 fail closed 语义（与
   * `TenantResolutionService` 同一约定，便于单测直驱返回值）。
   */
  async resolveOwner(params: {
    resourceType: MultitenantResourceType
    resourceId: number
    /** 传入时顺带完成比对，省一次调用。 */
    effectiveOrganizationId?: number | null
  }): Promise<TenantOwnershipResolution> {
    const descriptor = this.descriptorOf(params.resourceType)

    if (descriptor.kind === 'unsupported' || !descriptor.table || !descriptor.column) {
      // fail closed：不可解析 ≠ 放行。
      return {
        resourceType: params.resourceType,
        organizationId: null,
        found: false,
        matches: false,
        reason: 'RESOLVER_FAILED',
      }
    }

    let organizationId: number | null = null
    let found = false

    try {
      if (descriptor.kind === 'direct') {
        const row = await db
          .from(descriptor.table)
          .where('id', params.resourceId)
          .select(descriptor.column)
          .first()
        if (row) {
          found = true
          const value = (row as Record<string, unknown>)[descriptor.column]
          organizationId = value === null || value === undefined ? null : Number(value)
        }
      } else {
        // derived：先取父级外键，再跳到父表取组织列。
        const row = await db
          .from(descriptor.table)
          .where('id', params.resourceId)
          .select(descriptor.column)
          .first()
        if (row) {
          found = true
          const parentId = (row as Record<string, unknown>)[descriptor.column]
          if (parentId !== null && parentId !== undefined) {
            const parent = await db
              .from(descriptor.parentTable as string)
              .where('id', Number(parentId))
              .select(descriptor.parentColumn as string)
              .first()
            if (parent) {
              const value = (parent as Record<string, unknown>)[descriptor.parentColumn as string]
              organizationId = value === null || value === undefined ? null : Number(value)
            }
          }
        }
      }
    } catch {
      // resolver 依赖故障：degraded 且 fail closed（§3.5 同一处理）。
      return {
        resourceType: params.resourceType,
        organizationId: null,
        found: false,
        matches: false,
        reason: 'RESOLVER_FAILED',
      }
    }

    if (!found) {
      return {
        resourceType: params.resourceType,
        organizationId: null,
        found: false,
        matches: params.effectiveOrganizationId === undefined ? null : false,
        reason: 'RESOURCE_OWNERSHIP_MISMATCH',
      }
    }

    if (params.effectiveOrganizationId === undefined) {
      return {
        resourceType: params.resourceType,
        organizationId,
        found: true,
        matches: null,
        reason: 'RESOLVED',
      }
    }

    // 归属为 null（历史脏数据 / 全局行）也视为不匹配：不给"无归属即人人可读"留口子。
    const matches =
      organizationId !== null && organizationId === (params.effectiveOrganizationId ?? null)

    return {
      resourceType: params.resourceType,
      organizationId,
      found: true,
      matches,
      reason: matches ? 'RESOLVED' : 'RESOURCE_OWNERSHIP_MISMATCH',
    }
  }

  /**
   * 断言资源属于当前有效租户，否则抛非泄露 404。
   *
   * 统一 404（不是 403）是刻意的：403 与 404 的差异本身就会泄露"这个 ID 存在但不属于你"，
   * 也就泄露了他组织的资源存在性。资源不存在、属于他组织、resolver 不可用三种情况
   * 对外完全一致。
   */
  async assertOwnedByTenant(params: {
    resourceType: MultitenantResourceType
    resourceId: number
    effectiveOrganizationId: number | null
  }): Promise<TenantOwnershipResolution> {
    const resolution = await this.resolveOwner({
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      effectiveOrganizationId: params.effectiveOrganizationId,
    })

    if (!resolution.matches) {
      throw new ResourceNotFoundException('资源不存在')
    }
    return resolution
  }

  /**
   * 带低敏审计的归属断言（§5.3 的 Controller 接入点）。
   *
   * 用在"路由只带资源 ID、没有组织路由参数"的高风险入口，作为 Service 层 scoped 查询
   * 之外的**显式前置校验**：
   *  - 在业务逻辑之前拒绝，不给"先取数、后忘记比对"留窗口；
   *  - 拒绝语义统一（404「资源不存在」），不依赖各 Controller 各自记得返回哪个码；
   *  - 是识别链路里唯一会写 `ownership.*` 审计的一道，跨租户尝试因此可追溯。
   *
   * 关于 super admin：`effectiveOrganizationId` 落成 0（isolation-architecture 核准时
   * 定性过的隐式全局通道）或 null 时一律拒绝——§6.2 要求普通业务资源必须具体组织 scope。
   */
  async assertRouteResourceOwnership(params: {
    resourceType: MultitenantResourceType
    resourceId: number
    effectiveOrganizationId: number | null
    decision: EffectiveTenantContext | null
    userId: number | null
    requestId: string
  }): Promise<TenantOwnershipResolution> {
    const { decision } = params
    const auditBase = {
      actorRef: decision?.actorRef ?? 'user:unknown',
      userId: params.userId,
      projectId: null,
      scopeMode: decision?.scopeMode ?? ('tenant' as const),
      selectionSource: decision?.selectionSource ?? ('auth_token' as const),
      scopeHash: decision?.scopeHash ?? '',
      operation: `ownership.${params.resourceType}`,
      requestId: params.requestId,
    }

    if (params.effectiveOrganizationId === null || params.effectiveOrganizationId === 0) {
      await this.identificationAudit.recordDenial({
        ...auditBase,
        // 未解析出具体租户：审计里也就没有组织可记。
        organizationId: null,
        resolutionReason: 'NO_ACTIVE_ORGANIZATION',
      })
      throw new ResourceNotFoundException('资源不存在')
    }

    const resolution = await this.resolveOwner({
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      effectiveOrganizationId: params.effectiveOrganizationId,
    })

    if (!resolution.matches) {
      await this.identificationAudit.recordDenial({
        ...auditBase,
        // 记 actor 自己的组织，**不记**目标资源归属（否则审计成为跨租存在性侧信道）。
        organizationId: params.effectiveOrganizationId,
        resolutionReason: resolution.reason,
      })
      throw new ResourceNotFoundException('资源不存在')
    }

    return resolution
  }
}
