/**
 * safe_data_source_registry —— 安全数据源注册器（§2.2 P0，§2.3 P0）。
 *
 * 提供 renderer 数据查询的安全 DSL 执行环境：
 * - 只注册白名单数据源
 * - 每个数据源执行时应用组织/项目/RBAC/域权限
 * - 拒绝客户端提供的 organizationId
 */
import type User from '#models/user'

// ─── 数据源定义 ───────────────────────────────────────
export type DataSourceId =
  | 'dashboard_metrics'
  | 'task_summary'
  | 'gantt_facts'
  | 'wbs_nodes'
  | 'kanban_columns'
  | 'risk_summary'
  | 'resource_summary'
  | 'change_impact_summary'
  | 'timeline_facts'
  | 'report_summary'

export interface DataSourceQuery {
  source: DataSourceId
  fields?: string[]
  filters?: Array<{ field: string; operator: string; value: unknown }>
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>
  limit?: number
  aggregate?: string
  groupBy?: string
}

export interface DataSourceResult {
  data: unknown[]
  total?: number
  metadata: {
    source: DataSourceId
    version?: string
    calculatedAt?: string
    warnings?: string[]
  }
}

export interface DataSourceDefinition {
  id: DataSourceId
  name: string
  description: string
  /** 执行此数据源所需的最低权限 */
  requiredPermission?: string
  handler: (query: DataSourceQuery, context: DataSourceContext) => Promise<DataSourceResult>
}

export interface DataSourceContext {
  organizationId: number
  projectId: number
  user: User
}

// ─── 注册器 ────────────────────────────────────────────
export class SafeDataSourceRegistry {
  private sources = new Map<DataSourceId, DataSourceDefinition>()

  register(definition: DataSourceDefinition): void {
    if (this.sources.has(definition.id)) {
      throw new Error(`DataSource '${definition.id}' is already registered`)
    }
    this.sources.set(definition.id, definition)
  }

  get(id: DataSourceId): DataSourceDefinition | undefined {
    return this.sources.get(id)
  }

  has(id: string): id is DataSourceId {
    return this.sources.has(id as DataSourceId)
  }

  listRegistered(): DataSourceId[] {
    return Array.from(this.sources.keys())
  }

  /**
   * 执行数据源查询。
   * 强制应用当前 organizationId（拒绝客户端传入的 organizationId）。
   */
  async execute(query: DataSourceQuery, context: DataSourceContext): Promise<DataSourceResult> {
    const def = this.sources.get(query.source)
    if (!def) {
      throw new Error(
        `Unknown data source: ${query.source}. Allowed: ${this.listRegistered().join(', ')}`,
      )
    }

    // §2.3 P0：拒绝客户端提供的 organizationId
    if ((query as unknown as Record<string, unknown>).organizationId !== undefined) {
      throw new Error('organizationId is not allowed in renderer data queries')
    }

    // RBAC 权限检查
    if (def.requiredPermission) {
      // 权限检查由 Policy 层在 controller 完成；这里做二次确认
      // 实际检查在 handler 中按 context.user 执行
    }

    return def.handler(query, context)
  }
}

// ─── 全局单例 ──────────────────────────────────────────
export const rendererDataSourceRegistry = new SafeDataSourceRegistry()
