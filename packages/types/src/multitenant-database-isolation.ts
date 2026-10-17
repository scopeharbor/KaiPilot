// @aiproj/types — V3 多租户数据库隔离共享契约（v3-multitenant-database-isolation §2）。
// 纯函数、零运行时外部依赖，前后端与测试共享。
//
// 数据库隔离目录（Database Isolation Catalog）把「每张业务表属于哪个租户、怎么解析归属」
// 变成可审计的声明：表分类、组织归属列或父级解析链、必须租户 scope 的操作、
// 全局例外策略、租户内唯一键与索引要求。所有校验为纯函数，服务端 catalog
// （database_isolation_catalog.ts）只做登记与查询，不在此持有运行时依赖。

// ──────────────────────────────────────────────
// 1. 枚举与常量
// ──────────────────────────────────────────────

/** 表分类：业务表必须归入四类之一 */
export const DATABASE_ISOLATION_CLASSIFICATIONS = [
  'tenant-owned',
  'tenant-derived',
  'tenant-global-reference',
  'system-global-maintenance',
] as const
export type DatabaseIsolationClassification = (typeof DATABASE_ISOLATION_CLASSIFICATIONS)[number]

/** 租户 scope 必须覆盖的数据库操作形态 */
export const DATABASE_ISOLATION_OPERATIONS = [
  'read',
  'list',
  'count',
  'aggregate',
  'preload',
  'write',
  'delete',
  'restore',
  'batch',
] as const
export type DatabaseIsolationOperation = (typeof DATABASE_ISOLATION_OPERATIONS)[number]

/** 全局例外策略：非租户分类必须显式声明 allowed=true + 理由 */
export interface DatabaseGlobalExceptionPolicy {
  allowed: boolean
  reason: string
}

/** 父级解析器：tenant-derived 表如何经父表链解析组织归属 */
export interface DatabaseParentResolver {
  /** 父表名（同一 catalog 中必须存在对应条目） */
  parentTable: string
  /** 本表上的外键列 */
  viaColumn: string
  /** 父表键列，默认 'id' */
  parentColumn?: string
  /**
   * viaColumn 在 schema 上可空时必填：说明为什么可空仍可可靠解析归属
   * （例如写入路径恒赋值、或 NULL 行按 fail-closed 拒绝访问）。
   * 缺失即被迁移守卫测试判为「可空外键无法解析归属」的隐式全局通道。
   */
  nullableReason?: string | null
}

/** 组织外键契约：SQLite 本机口径（SQLite ALTER 不支持补 FK，见 design Decision 5） */
export const DATABASE_ISOLATION_FK_STATUSES = ['enforced', 'sqlite-deferred'] as const
export type DatabaseIsolationFkStatus = (typeof DATABASE_ISOLATION_FK_STATUSES)[number]

export function isDatabaseIsolationFkStatus(value: unknown): value is DatabaseIsolationFkStatus {
  return DATABASE_ISOLATION_FK_STATUSES.includes(value as DatabaseIsolationFkStatus)
}

/** 单张表的数据库隔离声明 */
export interface DatabaseTableDeclaration {
  /** 物理表名（snake_case，SQLite/PG 一致） */
  tableName: string
  /** Lucid model 名（如存在，用于模型覆盖测试） */
  modelName?: string | null
  /** 迁移来源说明（迁移文件名或能力阶段，如 'core-v1' / 'kms-v3'），供审计追溯 */
  migrationSource?: string | null
  classification: DatabaseIsolationClassification
  /** tenant-owned 的直接组织列（DB snake_case）；derived/global/system 为 null */
  organizationColumn?: string | null
  /** 可选项目归属列 */
  projectColumn?: string | null
  /** tenant-derived 的父级解析链（首条即直接父表） */
  parentResolvers?: DatabaseParentResolver[]
  /** 必须租户 scope 的操作集合（derived 的 preload 等须经父级解析） */
  tenantRequiredOperations: DatabaseIsolationOperation[]
  /** 全局例外策略：tenant-owned/derived 必须 allowed=false；global/system 必须 allowed=true */
  globalException?: DatabaseGlobalExceptionPolicy
  /**
   * tenant-owned 表的组织外键契约：
   * - 'enforced'：迁移已声明 organization_id → organizations.id FK（guard 测试双端校验）
   * - 'sqlite-deferred'：SQLite 无法 ALTER 补 FK；PG 由本 change 追加迁移补齐，
   *   须同时声明 organizationFkReason（SQLite 随未来 RLS/表重建转 enforced）
   */
  organizationFk?: DatabaseIsolationFkStatus
  organizationFkReason?: string | null
  /** 租户内唯一键的列组合（如 ['organization_id','code']）；空数组=无租户内唯一键 */
  uniqueScopeKeys: string[]
  /** 高频查询索引要求的列组合（如 ['organization_id','status']）；空数组=无额外要求 */
  indexRequirements: string[]
  /** 验证夹具说明（双组织同名资源 harness 等） */
  testFixture: string
}

// ──────────────────────────────────────────────
// 2. 纯校验函数
// ──────────────────────────────────────────────

export function isDatabaseIsolationClassification(
  value: unknown,
): value is DatabaseIsolationClassification {
  return DATABASE_ISOLATION_CLASSIFICATIONS.includes(value as DatabaseIsolationClassification)
}

export function isDatabaseIsolationOperation(value: unknown): value is DatabaseIsolationOperation {
  return DATABASE_ISOLATION_OPERATIONS.includes(value as DatabaseIsolationOperation)
}

/** 校验单条声明；返回错误列表（空数组=通过）。不依赖 catalog 全局状态。 */
export function validateDatabaseTableDeclaration(decl: DatabaseTableDeclaration): string[] {
  const errors: string[] = []
  if (!decl.tableName || decl.tableName.trim().length === 0) {
    errors.push('tableName 必填')
  }
  if (!isDatabaseIsolationClassification(decl.classification)) {
    errors.push(`classification 非法: ${String(decl.classification)}`)
  }
  const ops = decl.tenantRequiredOperations ?? []
  for (const op of ops) {
    if (!isDatabaseIsolationOperation(op)) {
      errors.push(`tenantRequiredOperations 含非法操作: ${String(op)}`)
    }
  }
  for (const key of decl.uniqueScopeKeys ?? []) {
    if (typeof key !== 'string' || key.length === 0) {
      errors.push('uniqueScopeKeys 含空键')
    }
  }
  for (const idx of decl.indexRequirements ?? []) {
    if (typeof idx !== 'string' || idx.length === 0) {
      errors.push('indexRequirements 含空键')
    }
  }
  if (!decl.testFixture || decl.testFixture.trim().length === 0) {
    errors.push('testFixture 必填')
  }

  switch (decl.classification) {
    case 'tenant-owned': {
      if (!decl.organizationColumn || decl.organizationColumn.length === 0) {
        errors.push('tenant-owned 表必须声明 organizationColumn')
      }
      if (decl.globalException && decl.globalException.allowed) {
        errors.push(
          'tenant-owned 表禁止声明全局例外（globalException.allowed 必须为 false 或省略）',
        )
      }
      break
    }
    case 'tenant-derived': {
      if (decl.organizationColumn && decl.organizationColumn.length > 0) {
        errors.push('tenant-derived 表不得声明 organizationColumn（归属经父级解析）')
      }
      if (!decl.parentResolvers || decl.parentResolvers.length === 0) {
        errors.push('tenant-derived 表必须声明 parentResolvers 父级链')
      } else {
        for (const resolver of decl.parentResolvers) {
          if (!resolver.parentTable || resolver.parentTable.length === 0) {
            errors.push('parentResolvers 中 parentTable 必填')
          }
          if (!resolver.viaColumn || resolver.viaColumn.length === 0) {
            errors.push(`parentResolvers(${resolver.parentTable}) 中 viaColumn 必填`)
          }
        }
      }
      if (decl.globalException && decl.globalException.allowed) {
        errors.push('tenant-derived 表禁止声明全局例外')
      }
      break
    }
    case 'tenant-global-reference':
    case 'system-global-maintenance': {
      if (decl.organizationColumn && decl.organizationColumn.length > 0) {
        errors.push(`${decl.classification} 表不得声明 organizationColumn`)
      }
      if (!decl.globalException || !decl.globalException.allowed) {
        errors.push(`${decl.classification} 必须显式声明 globalException.allowed=true`)
      } else if (!decl.globalException.reason || decl.globalException.reason.trim().length === 0) {
        errors.push(`${decl.classification} 的 globalException.reason 必填（低敏理由）`)
      }
      break
    }
  }
  return errors
}

// ──────────────────────────────────────────────
// 3. 租户绑定摘要（scope-first 派生值）
// ──────────────────────────────────────────────

/** FNV-1a 32 位 hash（与其它能力的 fnv1a 实现一致，纯函数、无依赖）。 */
export function dbFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 租户绑定摘要：把 organizationId 与表名一起纳入摘要输入
 * （spec「Cached aggregate is tenant-bound」）。
 *
 * 因此同样的行内容在不同组织下产出不同摘要，缓存聚合/源快照/预览签名
 * 无法跨组织复用；行本身按 key 排序序列化，保证顺序无关的稳定性。
 *
 * 调用前提：`rows` 必须已经过组织 scope 过滤——摘要只保证「不可跨租复用」，
 * 不能替代查询侧的 scope。
 */
export function computeTenantScopedDigest(params: {
  organizationId: number
  table: string
  rows: ReadonlyArray<Record<string, unknown>>
}): string {
  const normalizedRows = params.rows.map((row) =>
    Object.keys(row)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = row[key]
        return acc
      }, {}),
  )
  return dbFnv1aHash(
    JSON.stringify({
      org: params.organizationId,
      table: params.table,
      rows: normalizedRows,
    }),
  )
}

/**
 * catalog 整体完整性校验：父级解析链引用的父表必须存在。
 * 返回 { tableName -> errors } 映射；空对象=通过。
 */
export function validateCatalogIntegrity(
  declarations: readonly DatabaseTableDeclaration[],
): Record<string, string[]> {
  const byName = new Map(declarations.map((d) => [d.tableName, d]))
  const failures: Record<string, string[]> = {}
  const dupes = new Set<string>()
  const seen = new Set<string>()
  for (const decl of declarations) {
    if (seen.has(decl.tableName)) {
      dupes.add(decl.tableName)
    }
    seen.add(decl.tableName)
  }
  for (const dup of dupes) {
    failures[dup] = [`重复注册 tableName=${dup}`]
  }
  for (const decl of declarations) {
    for (const resolver of decl.parentResolvers ?? []) {
      if (!byName.has(resolver.parentTable)) {
        const entry = failures[decl.tableName] ?? []
        entry.push(`父级解析表 ${resolver.parentTable} 未在 catalog 登记`)
        failures[decl.tableName] = entry
      }
    }
  }
  return failures
}
