import { describe, expect, it } from 'vitest'
import {
  DATABASE_ISOLATION_CLASSIFICATIONS,
  DATABASE_ISOLATION_OPERATIONS,
  computeTenantScopedDigest,
  dbFnv1aHash,
  isDatabaseIsolationClassification,
  isDatabaseIsolationOperation,
  validateCatalogIntegrity,
  validateDatabaseTableDeclaration,
  type DatabaseTableDeclaration,
} from './multitenant-database-isolation.js'

function ownedTable(overrides: Partial<DatabaseTableDeclaration> = {}): DatabaseTableDeclaration {
  return {
    tableName: 'projects',
    modelName: 'Project',
    migrationSource: 'core-v1',
    classification: 'tenant-owned',
    organizationColumn: 'organization_id',
    projectColumn: null,
    tenantRequiredOperations: [...DATABASE_ISOLATION_OPERATIONS],
    uniqueScopeKeys: ['organization_id', 'code'],
    indexRequirements: ['organization_id'],
    testFixture: 'cross-tenant',
    ...overrides,
  }
}

describe('multitenant-database-isolation 契约', () => {
  it('枚举值合法且互斥', () => {
    expect(DATABASE_ISOLATION_CLASSIFICATIONS).toHaveLength(4)
    expect(DATABASE_ISOLATION_OPERATIONS).toHaveLength(9)
    for (const c of DATABASE_ISOLATION_CLASSIFICATIONS) {
      expect(isDatabaseIsolationClassification(c)).toBe(true)
    }
    for (const op of DATABASE_ISOLATION_OPERATIONS) {
      expect(isDatabaseIsolationOperation(op)).toBe(true)
    }
    expect(isDatabaseIsolationClassification('tenant-evil')).toBe(false)
    expect(isDatabaseIsolationOperation('truncate')).toBe(false)
  })

  it('tenant-owned 表必须有 organizationColumn', () => {
    const errors = validateDatabaseTableDeclaration(ownedTable({ organizationColumn: null }))
    expect(errors.some((e) => e.includes('organizationColumn'))).toBe(true)
  })

  it('tenant-owned 表禁止声明全局例外', () => {
    const errors = validateDatabaseTableDeclaration(
      ownedTable({ globalException: { allowed: true, reason: '不该允许' } }),
    )
    expect(errors.some((e) => e.includes('全局例外'))).toBe(true)
  })

  it('tenant-derived 表必须声明父级链且不得带 organizationColumn', () => {
    const errors = validateDatabaseTableDeclaration(
      ownedTable({
        tableName: 'tasks',
        classification: 'tenant-derived',
        organizationColumn: null,
        parentResolvers: [],
      }),
    )
    expect(errors.some((e) => e.includes('parentResolvers'))).toBe(true)

    const noOrg = validateDatabaseTableDeclaration(
      ownedTable({
        tableName: 'tasks',
        classification: 'tenant-derived',
        organizationColumn: 'organization_id',
        parentResolvers: [{ parentTable: 'projects', viaColumn: 'project_id' }],
      }),
    )
    expect(noOrg.some((e) => e.includes('不得声明 organizationColumn'))).toBe(true)
  })

  it('tenant-derived 表禁止声明全局例外', () => {
    const errors = validateDatabaseTableDeclaration(
      ownedTable({
        tableName: 'tasks',
        classification: 'tenant-derived',
        organizationColumn: null,
        parentResolvers: [{ parentTable: 'projects', viaColumn: 'project_id' }],
        globalException: { allowed: true, reason: '不该允许' },
      }),
    )
    expect(errors.some((e) => e.includes('全局例外'))).toBe(true)
  })

  it('global/system 表必须显式声明 allowed 例外并附低敏理由', () => {
    const noPolicy = validateDatabaseTableDeclaration(
      ownedTable({
        tableName: 'ai_model_catalog_snapshots',
        classification: 'tenant-global-reference',
        organizationColumn: null,
      }),
    )
    expect(noPolicy.some((e) => e.includes('globalException'))).toBe(true)

    const noReason = validateDatabaseTableDeclaration(
      ownedTable({
        tableName: 'ai_model_catalog_snapshots',
        classification: 'system-global-maintenance',
        organizationColumn: null,
        globalException: { allowed: true, reason: '' },
      }),
    )
    expect(noReason.some((e) => e.includes('reason'))).toBe(true)

    const ok = validateDatabaseTableDeclaration(
      ownedTable({
        tableName: 'ai_model_catalog_snapshots',
        classification: 'tenant-global-reference',
        organizationColumn: null,
        globalException: { allowed: true, reason: '供应商目录快照，平台级只读引用' },
      }),
    )
    expect(ok).toEqual([])
  })

  it('global/system 表不得带 organizationColumn', () => {
    const errors = validateDatabaseTableDeclaration(
      ownedTable({
        tableName: 'users',
        classification: 'system-global-maintenance',
        organizationColumn: 'organization_id',
        globalException: { allowed: true, reason: '账号平台级' },
      }),
    )
    expect(errors.some((e) => e.includes('不得声明 organizationColumn'))).toBe(true)
  })

  it('非法操作枚举被拒绝', () => {
    const errors = validateDatabaseTableDeclaration(
      ownedTable({
        tenantRequiredOperations: [
          'read',
          'drop',
        ] as unknown as DatabaseTableDeclaration['tenantRequiredOperations'],
      }),
    )
    expect(errors.some((e) => e.includes('非法操作'))).toBe(true)
  })

  it('catalog 完整性校验拒绝悬空父级与重复登记', () => {
    const projects = ownedTable()
    const tasks = ownedTable({
      tableName: 'tasks',
      classification: 'tenant-derived',
      organizationColumn: null,
      parentResolvers: [{ parentTable: 'projects', viaColumn: 'project_id' }],
    })
    const orphan = ownedTable({
      tableName: 'kms_key_versions',
      classification: 'tenant-derived',
      organizationColumn: null,
      parentResolvers: [{ parentTable: 'no_such_table', viaColumn: 'key_ring_id' }],
    })
    const failures = validateCatalogIntegrity([projects, tasks, orphan, orphan])
    expect(failures['kms_key_versions'].some((e) => e.includes('未在 catalog 登记'))).toBe(true)
    expect(failures['kms_key_versions'].some((e) => e.includes('重复注册'))).toBe(true)
    expect(failures['tasks']).toBeUndefined()
  })
})

describe('租户绑定摘要（§4.2 scope-first 派生值）', () => {
  const rows = [{ name: '同名项目', code: 'P-1' }]

  it('摘要稳定：键顺序与行顺序标准化后结果一致', () => {
    const a = computeTenantScopedDigest({ organizationId: 1, table: 'projects', rows })
    const b = computeTenantScopedDigest({
      organizationId: 1,
      table: 'projects',
      rows: [{ code: 'P-1', name: '同名项目' }],
    })
    expect(a).toBe(b)
  })

  it('同内容跨组织必须产出不同摘要（缓存聚合不可跨租复用）', () => {
    const a = computeTenantScopedDigest({ organizationId: 1, table: 'projects', rows })
    const b = computeTenantScopedDigest({ organizationId: 2, table: 'projects', rows })
    expect(a).not.toBe(b)
  })

  it('同内容跨表也必须产出不同摘要', () => {
    const a = computeTenantScopedDigest({ organizationId: 1, table: 'projects', rows })
    const b = computeTenantScopedDigest({ organizationId: 1, table: 'tasks', rows })
    expect(a).not.toBe(b)
  })

  it('空行集合仍产出稳定且组织相关的摘要', () => {
    const a = computeTenantScopedDigest({ organizationId: 1, table: 'projects', rows: [] })
    const b = computeTenantScopedDigest({ organizationId: 1, table: 'projects', rows: [] })
    const c = computeTenantScopedDigest({ organizationId: 2, table: 'projects', rows: [] })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('dbFnv1aHash 输出 8 位定长 hex', () => {
    expect(dbFnv1aHash('')).toMatch(/^[0-9a-f]{8}$/)
    expect(dbFnv1aHash('projects:1')).toMatch(/^[0-9a-f]{8}$/)
    expect(dbFnv1aHash('a')).not.toBe(dbFnv1aHash('b'))
  })
})

describe('父级链可空列声明（§3.4 nullableReason）', () => {
  it('可空父级列可携带 nullableReason 而不影响声明校验', () => {
    const errors = validateDatabaseTableDeclaration({
      tableName: 'attachments',
      classification: 'tenant-derived',
      organizationColumn: null,
      parentResolvers: [
        {
          parentTable: 'projects',
          viaColumn: 'project_id',
          nullableReason: 'V1 遗留可空列；写入路径恒赋值，读取 fail closed',
        },
      ],
      tenantRequiredOperations: [...DATABASE_ISOLATION_OPERATIONS],
      uniqueScopeKeys: [],
      indexRequirements: [],
      testFixture: '父链跨租户负例 harness',
    })
    expect(errors).toEqual([])
  })
})
