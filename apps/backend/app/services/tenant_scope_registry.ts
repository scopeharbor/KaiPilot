// @aiproj/backend — Tenant Scope Registry（v3-multitenant-isolation-architecture §3.2）。
//
// 每类租户资源通过 TenantResourceDeclaration 声明其归属：
// - organizationField：资源行上标识所属组织的字段（DB snake_case 列名，供 Lucid where 使用；
//   null = 该资源无直接组织列，归属必须经 parentResolver='project' 的项目父级派生（如
//   task/wbs/member/file/report），scope 查询以 projectField 过滤）
// - projectField：可选的项目归属字段
// - parentResolver：父子归属解析方式（'project' | 'organization' | 'none'）
// - allowSuperAdminGlobal：super admin 全局读是否显式允许（默认 false，全局必须 opt-in）
// - registryStatus：'registered'（实现就绪）/ 'degraded' / 'unsupported'（邻域能力缺失时的显式降级）
// - errorSemantics：跨租户非泄露错误语义（RESOURCE_NOT_FOUND / PERMISSION_DENIED）
//
// Service/Policy 不直接猜字段名，统一经本 registry 生成查询与归属校验（design Decision 2）。

import { PermissionDeniedException } from '#exceptions/api_exception'
import {
  MULTITENANT_REGISTRY_STATUSES,
  type MultitenantRegistryStatus,
  type MultitenantResourceType,
  type TenantResourceDeclaration,
} from '@aiproj/types/multitenant-isolation-architecture'

/**
 * 核心租户资源声明清单（事实源）。
 * 覆盖：组织/项目/任务/WBS/成员/文件/报表/审计/AI 草案/Compiler run+artifact/
 * KMS/DLP/水印/合规证据/来源归属/知识条目。
 * 邻域 V3 能力（如 connection pool management）为连接资源治理，不新增租户数据资源，
 * 无需 degraded 条目；已标注的 degraded/unsupported 表示该资源类型尚无完整租户实现。
 *
 * degraded/unsupported 的登记理由、当前条目与转正条件见
 * `openspec/changes/v3-multitenant-isolation-architecture/observation-and-inventory.md` §5；
 * 清单变更会让 `tests/unit/tenant_scope_inventory.spec.ts` 失败，须同步该文档。
 */
const REGISTERED_DECLARATIONS: readonly TenantResourceDeclaration[] = [
  {
    resourceType: 'organization',
    organizationField: 'id',
    projectField: null,
    parentResolver: 'none',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'organization',
  },
  {
    resourceType: 'project',
    organizationField: 'organization_id',
    projectField: 'id',
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'project',
  },
  {
    resourceType: 'task',
    organizationField: null,
    projectField: 'project_id',
    parentResolver: 'project',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'task',
  },
  {
    resourceType: 'wbs',
    organizationField: null,
    projectField: 'project_id',
    parentResolver: 'project',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'wbs',
  },
  {
    resourceType: 'member',
    organizationField: null,
    projectField: 'project_id',
    parentResolver: 'project',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'member',
  },
  {
    resourceType: 'file',
    organizationField: null,
    projectField: 'project_id',
    parentResolver: 'project',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'file',
  },
  {
    resourceType: 'report',
    organizationField: null,
    projectField: 'project_id',
    parentResolver: 'project',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'report',
  },
  {
    resourceType: 'audit',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'audit',
  },
  {
    resourceType: 'ai_draft',
    organizationField: 'organization_id',
    projectField: 'project_id',
    parentResolver: 'project',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'ai_draft',
  },
  {
    resourceType: 'compiler_run',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'compiler_run',
  },
  {
    resourceType: 'compiler_artifact',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'compiler_artifact',
  },
  {
    resourceType: 'source_attribution',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'degraded',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'source_attribution',
  },
  {
    resourceType: 'knowledge_item',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'knowledge_item',
  },
  // v3-plugin-private-registry-lifecycle：组织私有插件目录的四类租户数据。
  // 四张表（entries/releases/reviews/operations）都有直接 organization_id 列；
  // 目录内容属组织私有资产，跨租一律 RESOURCE_NOT_FOUND，不允许 super admin 全局读。
  {
    resourceType: 'plugin_registry_entry',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'plugin_registry_entry',
  },
  {
    resourceType: 'plugin_registry_release',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'plugin_registry_release',
  },
  {
    resourceType: 'plugin_registry_review',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'plugin_registry_review',
  },
  {
    resourceType: 'plugin_registry_operation',
    organizationField: 'organization_id',
    projectField: null,
    parentResolver: 'organization',
    allowSuperAdminGlobal: false,
    registryStatus: 'registered',
    errorSemantics: 'RESOURCE_NOT_FOUND',
    auditResourceType: 'plugin_registry_operation',
  },
]

/**
 * TenantScopeRegistry —— 资源归属声明事实源。
 * 默认 scoped-only；global 必须显式声明（registryStatus/allowSuperAdminGlobal）。
 */
export default class TenantScopeRegistry {
  private static readonly declarations = new Map<
    MultitenantResourceType,
    TenantResourceDeclaration
  >(REGISTERED_DECLARATIONS.map((d) => [d.resourceType, d]))

  /**
   * 校验整个 registry 的声明完整性：
   * - 'registered' 资源：带直接组织列（organizationField 非空）→ 须有合法 parentResolver；
   *   无直接组织列（null）→ 必须是 parentResolver='project' 的项目派生资源且带 projectField
   * - 每项必须有合法 errorSemantics/auditResourceType；degraded/unsupported 必须显式声明状态
   * 任一违规即抛错（供 3.3 测试与启动自检使用）。
   */
  static validate(): void {
    for (const decl of REGISTERED_DECLARATIONS) {
      this.validateDeclaration(decl)
    }
    const seen = new Set<string>()
    for (const decl of REGISTERED_DECLARATIONS) {
      if (seen.has(decl.resourceType)) {
        throw new Error(`TenantScopeRegistry: 重复注册 resourceType=${decl.resourceType}`)
      }
      seen.add(decl.resourceType)
    }
  }

  static validateDeclaration(decl: TenantResourceDeclaration): void {
    if (decl.registryStatus === 'registered') {
      if (decl.organizationField && decl.organizationField.length > 0) {
        if (
          !decl.parentResolver ||
          !['project', 'organization', 'none'].includes(decl.parentResolver)
        ) {
          throw new Error(`TenantScopeRegistry: ${decl.resourceType} 缺少合法 parentResolver`)
        }
      } else {
        // 无直接组织列（task/wbs/member/file/report 等）：归属必须经项目父级派生
        if (decl.parentResolver !== 'project' || !decl.projectField) {
          throw new Error(
            `TenantScopeRegistry: ${decl.resourceType} 缺少组织列但未声明为项目派生（需 parentResolver='project' + projectField）`,
          )
        }
      }
    } else if (!MULTITENANT_REGISTRY_STATUSES.includes(decl.registryStatus)) {
      throw new Error(
        `TenantScopeRegistry: ${decl.resourceType} 状态非法: ${String(decl.registryStatus)}`,
      )
    }
    if (!decl.auditResourceType || decl.auditResourceType.length === 0) {
      throw new Error(`TenantScopeRegistry: ${decl.resourceType} 缺少 auditResourceType`)
    }
    if (!['RESOURCE_NOT_FOUND', 'PERMISSION_DENIED'].includes(decl.errorSemantics)) {
      throw new Error(`TenantScopeRegistry: ${decl.resourceType} errorSemantics 非法`)
    }
  }

  /**
   * 获取资源声明；未注册抛错（fail closed）。
   */
  static get(resourceType: MultitenantResourceType): TenantResourceDeclaration {
    const decl = this.declarations.get(resourceType)
    if (!decl) {
      throw new Error(`TenantScopeRegistry: 未注册资源类型 ${resourceType}`)
    }
    return decl
  }

  /**
   * 列出全部声明（按注册顺序）。
   */
  static all(): TenantResourceDeclaration[] {
    return [...REGISTERED_DECLARATIONS]
  }

  /**
   * 取归属组织字段名（snake_case；null = 无直接组织列的项目派生资源，
   * scope 查询须经 projectField）。
   */
  static organizationFieldOf(resourceType: MultitenantResourceType): string | null {
    return this.get(resourceType).organizationField
  }

  /**
   * 全局访问必须显式声明：默认 deny。
   * super admin 的全局读仍须 registry 标记 allowSuperAdminGlobal=true 才放行。
   */
  static assertGlobalAllowed(resourceType: MultitenantResourceType): void {
    const decl = this.get(resourceType)
    if (!decl.allowSuperAdminGlobal) {
      throw new PermissionDeniedException('全局访问未显式允许')
    }
  }

  /**
   * registry 状态查询（供 inventory/降级路径使用）。
   */
  static statusOf(resourceType: MultitenantResourceType): MultitenantRegistryStatus {
    return this.get(resourceType).registryStatus
  }
}
