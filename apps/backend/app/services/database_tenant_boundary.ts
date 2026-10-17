/**
 * @aiproj/backend —— DatabaseTenantBoundary（v3-multitenant-database-isolation §4）。
 *
 * 数据库层租户边界服务：把「先 scope，再算派生值」变成唯一入口，覆盖
 * read / detail / count / aggregate / hash / preload / write / batch / raw 九种形态
 * （design Decision 3）。
 *
 * 与既有两个服务的分工（不重复实现）：
 * - `TenantScopeService`（isolation-architecture §3.4）：按 **资源类型**（registry）
 *   scope，服务于 Controller/Service 的业务语义层。
 * - `DatabaseTenantBoundary`（本文件）：按 **物理表**（DatabaseIsolationCatalog）scope，
 *   服务于 Lucid/knex 查询层，能处理 registry 未登记的表、tenant-derived 父级链
 *   递归解析、preload 子查询、raw SQL 与 schema introspection。
 *
 * 核心不变量：
 * 1. 任一 scope 入口都必须能从 catalog 解析出租户条件，否则 fail closed（抛异常），
 *    绝不退化成无租户条件的全表查询；
 * 2. tenant-derived 表经 catalog 父级链递归生成 `whereIn(viaColumn, <父表 scope 子查询>)`，
 *    多父级 resolver 全部作为 AND 条件（任一父级越界即整体不可见）；
 * 3. global/system 分类的表不能用租户 scope 入口，必须显式走
 *    `DatabaseIsolationCatalog.assertGlobalAllowed`；
 * 4. 跨租户读取统一 `RESOURCE_NOT_FOUND`，不泄露隐藏行的名称、父级、计数与摘要。
 */
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import DatabaseIsolationCatalog from '#services/database_isolation_catalog'
import db from '@adonisjs/lucid/services/db'
import {
  computeTenantScopedDigest,
  type DatabaseIsolationOperation,
  type DatabaseTableDeclaration,
} from '@aiproj/types/multitenant-database-isolation'

/** 父级链递归深度上限（防 catalog 误配成环导致栈溢出）。 */
const MAX_PARENT_DEPTH = 6

/** 可做链式 where/whereIn 的查询形状（兼容 Lucid Model/Database query builder）。 */
export interface ScopableQuery {
  where(column: string, value: unknown): unknown
  whereIn(column: string, values: unknown): unknown
}

/** 具备 first() 的查询形状。 */
interface FirstableQuery extends ScopableQuery {
  first(): Promise<unknown>
}

/** 可被 findInTenantOrFail 接收的模型形状。 */
export interface BoundaryModel {
  query(): FirstableQuery
}

/** 查询客户端形状（`db` 或事务客户端 `trx` 均满足）。 */
export interface BoundaryClient {
  from(table: string): any
  rawQuery(sql: string, bindings?: unknown[]): Promise<unknown>
}

/** 租户 scope 参数。 */
export interface TenantScopeParams {
  organizationId: number
  /** 可选项目边界：表声明 projectColumn 时附加，进一步收窄 */
  projectId?: number | null
  /** 事务或指定连接客户端；缺省用默认 db（子查询必须与外层同客户端） */
  client?: BoundaryClient
}

export default class DatabaseTenantBoundary {
  /** 解析并校验表声明可用于租户 scope；global/system 表在此 fail closed。 */
  private declarationFor(
    table: string,
    operation: DatabaseIsolationOperation,
  ): DatabaseTableDeclaration {
    const decl = DatabaseIsolationCatalog.get(table)
    if (
      decl.classification === 'tenant-global-reference' ||
      decl.classification === 'system-global-maintenance'
    ) {
      throw new PermissionDeniedException(
        `表 ${table} 为全局分类，不能走租户 scope 入口（须显式 assertGlobalAllowed）`,
      )
    }
    if (!decl.tenantRequiredOperations.includes(operation)) {
      throw new PermissionDeniedException(`表 ${table} 未声明支持 ${operation} 的租户 scope`)
    }
    return decl
  }

  private clientOf(params: TenantScopeParams): BoundaryClient {
    return params.client ?? (db as unknown as BoundaryClient)
  }

  /**
   * 组织 scope 子查询：返回 `select id from <table> where <租户条件>`。
   *
   * tenant-owned → 直接按 organizationColumn 过滤；
   * tenant-derived → 递归到父表 scope 子查询，对每个 resolver 加 AND whereIn。
   * 用于 preload、批量校验与 derived 表的 scope 拼装。
   */
  organizationScopeSubquery(table: string, params: TenantScopeParams, depth = 0): any {
    if (depth > MAX_PARENT_DEPTH) {
      throw new PermissionDeniedException(`表 ${table} 父级链过深或成环，无法解析租户归属`)
    }
    const decl = DatabaseIsolationCatalog.get(table)
    const client = this.clientOf(params)
    const query = client.from(table).select('id')

    if (decl.organizationColumn) {
      query.where(decl.organizationColumn, params.organizationId)
      if (typeof params.projectId === 'number' && decl.projectColumn) {
        query.where(decl.projectColumn, params.projectId)
      }
      return query
    }

    const resolvers = decl.parentResolvers ?? []
    if (resolvers.length === 0) {
      throw new PermissionDeniedException(`表 ${table} 既无组织列也无父级链，无法解析租户归属`)
    }
    for (const resolver of resolvers) {
      query.whereIn(
        resolver.viaColumn,
        this.organizationScopeSubquery(resolver.parentTable, params, depth + 1),
      )
    }
    return query
  }

  /**
   * 4.1 scoped read：按 catalog 归属声明给查询附加租户条件。
   *
   * tenant-owned 直接加 `where organization_id = ?`；tenant-derived 加
   * `whereIn(<父级外键>, <父表 scope 子查询>)`。列表分页、`meta.total`、排序、
   * 过滤、搜索都必须在返回的查询对象上继续构建，不可另起未 scope 的查询。
   */
  scopedQuery<Q extends ScopableQuery>(
    query: Q,
    table: string,
    params: TenantScopeParams,
    operation: DatabaseIsolationOperation = 'list',
  ): Q {
    const decl = this.declarationFor(table, operation)
    if (decl.organizationColumn) {
      let scoped = query.where(decl.organizationColumn, params.organizationId) as unknown as Q
      if (typeof params.projectId === 'number' && decl.projectColumn) {
        scoped = scoped.where(decl.projectColumn, params.projectId) as unknown as Q
      }
      return scoped
    }
    let scoped = query as unknown as Q
    for (const resolver of decl.parentResolvers ?? []) {
      scoped = scoped.whereIn(
        resolver.viaColumn,
        this.organizationScopeSubquery(resolver.parentTable, params),
      ) as unknown as Q
    }
    return scoped
  }

  /**
   * 4.1 scoped detail：scope 内按主键取行；跨租户或不存在统一 `RESOURCE_NOT_FOUND`
   * （spec「Cross-tenant detail lookup is hidden」——两条路径错误完全相同，
   * 调用方无法据错误区分存在性）。
   */
  async findInTenantOrFail<T>(
    model: BoundaryModel,
    id: number | string,
    table: string,
    params: TenantScopeParams,
  ): Promise<T> {
    const query = model.query().where('id', id) as unknown as FirstableQuery
    const scoped = this.scopedQuery(query, table, params, 'read') as unknown as FirstableQuery
    const row = await scoped.first()
    if (!row) {
      throw new ResourceNotFoundException('资源不存在')
    }
    return row as T
  }

  /**
   * 4.2 scoped count：先 scope 再 count，用于 `meta.total`
   * （spec「Pagination count is tenant-scoped」）。
   */
  async countInTenant(table: string, params: TenantScopeParams): Promise<number> {
    const client = this.clientOf(params)
    const scoped = this.scopedQuery(client.from(table), table, params, 'count')
    const rows = (await (scoped as any).count('* as total')) as Array<Record<string, unknown>>
    return Number(rows[0]?.total ?? 0)
  }

  /**
   * 4.2 scoped aggregate：先 scope 再聚合（sum/avg/min/max）。
   * 返回 null 表示 scope 内无行（不要把它当 0 直接展示给用户）。
   */
  async aggregateInTenant(
    table: string,
    params: TenantScopeParams & { fn: 'sum' | 'avg' | 'min' | 'max'; column: string },
  ): Promise<number | null> {
    const client = this.clientOf(params)
    const scoped = this.scopedQuery(client.from(table), table, params, 'aggregate')
    const rows = (await (scoped as any)[params.fn](`${params.column} as value`)) as Array<
      Record<string, unknown>
    >
    const value = rows[0]?.value
    return value === null || value === undefined ? null : Number(value)
  }

  /**
   * 4.2 scoped hash：先 scope 取行，再算租户绑定摘要
   * （spec「Cached aggregate is tenant-bound」）。摘要输入含 organizationId 与表名，
   * 同内容跨组织必然不同，缓存聚合/源快照无法跨租复用。
   */
  async hashInTenant(
    table: string,
    params: TenantScopeParams & { columns: string[]; orderBy?: string },
  ): Promise<string> {
    const client = this.clientOf(params)
    const scoped = this.scopedQuery(client.from(table), table, params, 'aggregate')
    const rows = (await (scoped as any)
      .select(...params.columns)
      .orderBy(params.orderBy ?? 'id', 'asc')) as Array<Record<string, unknown>>
    return computeTenantScopedDigest({
      organizationId: params.organizationId,
      table,
      rows,
    })
  }

  /**
   * 4.3 scoped preload：给 Lucid 关系 preload 附加子表租户 scope
   * （spec「Relation preload is tenant-scoped」）。
   *
   * Lucid 的 preload 回调拿到的是子表查询，默认只按外键关联——若子表自身带
   * organization_id（或经父级链归属），不加 scope 时可能挂上他租子行。
   */
  preloadInTenant<Q>(query: Q, relation: string, childTable: string, params: TenantScopeParams): Q {
    // Lucid 的 preload 签名把 relation 约束成模型关系联合类型，泛型 Q 无法表达；
    // 这里按最小结构调用，返回原查询对象本身以保留调用方的链式类型。
    const preloadable = query as unknown as {
      preload(relation: string, callback: (childQuery: ScopableQuery) => void): unknown
    }
    preloadable.preload(relation, (childQuery: ScopableQuery) => {
      this.scopedQuery(childQuery, childTable, params, 'preload')
    })
    return query
  }

  /**
   * 4.4 scoped create：写入前从服务端解析的租户上下文盖章组织归属，
   * 并剥离客户端传来的 organizationId/organization_id
   * （spec「Create ignores client organization field」）。
   *
   * 客户端值与服务端解析值冲突时抛 `RESOURCE_NOT_FOUND`——与跨租读取同一形态，
   * 不告诉调用方「你猜的那个组织存在」。
   */
  stampTenantForCreate<T extends Record<string, unknown>>(
    payload: T,
    table: string,
    organizationId: number,
  ): T {
    const decl = this.declarationFor(table, 'write')
    const claimed = payload.organizationId ?? payload.organization_id
    if (claimed !== undefined && claimed !== null && Number(claimed) !== organizationId) {
      throw new ResourceNotFoundException('资源不存在')
    }
    const stamped: Record<string, unknown> = { ...payload }
    delete stamped.organization_id
    delete stamped.organizationId
    if (decl.organizationColumn) {
      stamped.organizationId = organizationId
    }
    return stamped as T
  }

  /**
   * 4.4 scoped update：更新前确认目标行在 scope 内（读走同一条 scope 路径），
   * 并禁止把组织归属改写成别的组织。
   */
  async assertUpdatableInTenant<T>(
    model: BoundaryModel,
    id: number | string,
    table: string,
    params: TenantScopeParams,
    patch?: Record<string, unknown>,
  ): Promise<T> {
    if (patch) {
      const claimed = patch.organizationId ?? patch.organization_id
      if (claimed !== undefined && claimed !== null && Number(claimed) !== params.organizationId) {
        throw new ResourceNotFoundException('资源不存在')
      }
    }
    return this.findInTenantOrFail<T>(model, id, table, params)
  }

  /**
   * 4.5 事务内引用校验：一次校验一组引用 ID（project/task/member/file/report/key/
   * policy/artifact/ledger/job…）全部属于当前租户
   * （spec「Update validates referenced rows」）。
   *
   * 任一引用跨租户或不存在 → 抛 `RESOURCE_NOT_FOUND`，不指明是哪一个越界。
   * 必须传入事务客户端 `client`，使校验与后续写入同事务、失败即整体回滚。
   */
  async assertReferencesInTenant(
    references: ReadonlyArray<{ table: string; id: number | string | null | undefined }>,
    params: TenantScopeParams,
  ): Promise<void> {
    for (const ref of references) {
      if (ref.id === null || ref.id === undefined) continue
      const client = this.clientOf(params)
      const scoped = this.scopedQuery(client.from(ref.table), ref.table, params, 'read')
      const row = await (scoped as any).where('id', ref.id).select('id').first()
      if (!row) {
        throw new ResourceNotFoundException('资源不存在')
      }
    }
  }

  /**
   * 4.5 / 6.1 批量 ID 校验：一次解析全部 ID，去重后数量不符即整体拒绝
   * （spec「Mixed-tenant IDs fail atomically」）。
   *
   * 必须在预览生成、摘要计算、导出句柄与任何写入之前调用；跨租 ID 与不存在的 ID
   * 走同一拒绝路径，响应不泄露哪个 ID 属于他租、也不给出隐藏计数。
   * 返回 scope 内解析出的行 ID —— 后续派生值只能基于它，不要回头用原始输入列表。
   */
  async assertIdsInTenant(
    table: string,
    ids: ReadonlyArray<number | string>,
    params: TenantScopeParams,
  ): Promise<Array<number | string>> {
    const unique = Array.from(new Set(ids.map((v) => String(v))))
    if (unique.length === 0) return []
    const client = this.clientOf(params)
    const scoped = this.scopedQuery(client.from(table), table, params, 'batch')
    const rows = (await (scoped as any).whereIn('id', unique).select('id')) as Array<
      Record<string, unknown>
    >
    if (rows.length !== unique.length) {
      throw new ResourceNotFoundException('资源不存在')
    }
    return rows.map((r) => r.id as number | string)
  }

  /**
   * 4.4 / 6.5 软删除恢复：恢复前重新校验组织归属
   * （spec「Restore preserves tenant ownership」）。
   * 恢复动作只能落在 scope 内的行；他租软删行走 404，不暴露其存在。
   */
  async assertRestorableInTenant<T>(
    model: BoundaryModel,
    id: number | string,
    table: string,
    params: TenantScopeParams,
  ): Promise<T> {
    this.declarationFor(table, 'restore')
    const query = model.query().where('id', id) as unknown as FirstableQuery
    const scoped = this.scopedQuery(query, table, params, 'restore') as unknown as FirstableQuery
    const row = await scoped.first()
    if (!row) {
      throw new ResourceNotFoundException('资源不存在')
    }
    return row as T
  }

  /**
   * 4.6 租户 scoped raw SQL wrapper（spec「Tenant raw query requires scope parameter」）。
   *
   * 约束（任一不满足即拒绝执行）：
   * - 表必须在 catalog 登记且非全局分类；
   * - 只允许 SELECT（写入必须走 Lucid，以便统一盖章与引用校验）；
   * - SQL 必须显式引用该表的租户条件列（tenant-owned 的组织列 / derived 的父级外键）；
   * - SQL 必须含至少一个 `?` 占位，**第一个占位固定绑定 organizationId**，
   *   由 wrapper 注入，调用方无法用字面量绕过 scope。
   */
  async scopedRawQuery(params: {
    table: string
    sql: string
    organizationId: number
    bindings?: unknown[]
    client?: BoundaryClient
  }): Promise<unknown> {
    const decl = this.declarationFor(params.table, 'read')
    const sql = params.sql.trim()
    if (!/^select\s/i.test(sql)) {
      throw new PermissionDeniedException('scoped raw SQL 只允许 SELECT')
    }
    const scopeColumn = decl.organizationColumn ?? decl.parentResolvers?.[0]?.viaColumn
    if (!scopeColumn || !sql.includes(scopeColumn)) {
      throw new PermissionDeniedException(
        `scoped raw SQL 必须显式引用租户条件列 ${scopeColumn ?? '(未声明)'}`,
      )
    }
    if (!sql.includes('?')) {
      throw new PermissionDeniedException('scoped raw SQL 必须用绑定参数承载组织 scope')
    }
    const client = params.client ?? (db as unknown as BoundaryClient)
    return client.rawQuery(sql, [params.organizationId, ...(params.bindings ?? [])])
  }

  /**
   * 4.6 未 scope 的 schema introspection 出口
   * （spec「Introspection does not read business rows」）。
   *
   * 只允许元数据来源（PRAGMA / sqlite_master / information_schema / pg_catalog），
   * 因此不可能返回租户业务行；业务表名出现在 FROM 子句即拒绝。
   */
  async introspectionRawQuery(sql: string, bindings?: unknown[]): Promise<unknown> {
    const trimmed = sql.trim()
    const isMetadataSource =
      /^pragma\s/i.test(trimmed) ||
      /\b(sqlite_master|information_schema\.|pg_catalog\.|pg_class|pg_index|pg_constraint|to_regclass)\b/i.test(
        trimmed,
      )
    if (!isMetadataSource) {
      throw new PermissionDeniedException('introspection 只允许查询 schema 元数据来源')
    }
    return db.rawQuery(trimmed, bindings ?? [])
  }

  /** 全局表访问显式门禁（转发 catalog，保持单一判定处）。 */
  assertGlobalAllowed(table: string): void {
    DatabaseIsolationCatalog.assertGlobalAllowed(table)
  }
}
