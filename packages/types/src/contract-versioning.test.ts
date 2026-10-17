/**
 * contract-versioning.test —— 共享契约版本化单元测试（§1.4、§2.4、§2.5、§3.4、§3.5 P0）。
 *
 * 覆盖：版本原语解析/比较、变更分类、契约目录验证、兼容错误安全序列化、
 * 迁移适配器注册与链解析、缺口/环路/重复拒绝、幂等/输入突变/重复迁移、
 * 组织上下文与 AI 待确认保留。
 */
import { describe, expect, it } from 'vitest'
import {
  // 版本原语
  parseContractVersion,
  compareContractVersions,
  isVersionSupported,
  needsMigration,
  formatContractVersion,
  bumpMajor,
  bumpMinor,
  schemaVersionToContractVersion,
  contractVersionToSchemaVersion,

  // 变更分类
  type ChangeKind,
  CHANGE_KIND_ORDER,

  // 契约目录
  type ContractCatalogEntry,
  type ContractCatalog,
  type ContractKind,
  type SecurityClass,
  type AdoptionState,
  CONTRACT_CATALOG,
  validateCatalogEntry,
  validateCatalog,
  SECURITY_CLASS_ORDER,

  // 兼容错误
  CompatibilityError,
  unsupportedContractVersion,
  missingRequiredVersion,
  migrationChainBroken,
  organizationContextMissing,
  organizationContextMismatch,
  type CompatibilityErrorCode,

  // 迁移适配器注册表
  MigrationAdapterRegistry,
  type MigrationAdapter,
  type MigrationContext,
  globalMigrationRegistry,
} from './contract-versioning.js'

// =============================================================================
// 1. 版本原语测试（§1.4）
// =============================================================================

describe('parseContractVersion', () => {
  it('parses valid version string', () => {
    expect(parseContractVersion('1.0')).toEqual({ major: 1, minor: 0 })
    expect(parseContractVersion('2.3')).toEqual({ major: 2, minor: 3 })
    expect(parseContractVersion('0.1')).toEqual({ major: 0, minor: 1 })
    expect(parseContractVersion('10.99')).toEqual({ major: 10, minor: 99 })
  })

  it('throws on invalid version format', () => {
    expect(() => parseContractVersion('')).toThrow()
    expect(() => parseContractVersion('1')).toThrow()
    expect(() => parseContractVersion('a.b')).toThrow()
    expect(() => parseContractVersion('1.2.3')).toThrow()
    expect(() => parseContractVersion('-1.0')).toThrow()
    expect(() => parseContractVersion('1.-1')).toThrow()
  })

  it('throws on null or undefined', () => {
    expect(() => parseContractVersion(null as unknown as string)).toThrow()
    expect(() => parseContractVersion(undefined as unknown as string)).toThrow()
  })
})

describe('compareContractVersions', () => {
  it('returns eq for equal versions', () => {
    expect(compareContractVersions('1.0', '1.0')).toBe('eq')
    expect(compareContractVersions('2.3', '2.3')).toBe('eq')
  })

  it('returns lt when first < second', () => {
    expect(compareContractVersions('1.0', '2.0')).toBe('lt')
    expect(compareContractVersions('1.0', '1.1')).toBe('lt')
    expect(compareContractVersions('0.9', '1.0')).toBe('lt')
  })

  it('returns gt when first > second', () => {
    expect(compareContractVersions('2.0', '1.0')).toBe('gt')
    expect(compareContractVersions('1.1', '1.0')).toBe('gt')
    expect(compareContractVersions('3.0', '2.99')).toBe('gt')
  })

  // §2.4: test future major
  it('correctly compares future major versions', () => {
    expect(compareContractVersions('1.0', '99.0')).toBe('lt')
    expect(compareContractVersions('99.0', '1.0')).toBe('gt')
  })
})

describe('isVersionSupported', () => {
  it('returns true for current version', () => {
    expect(isVersionSupported('1.0', '1.0', [])).toBe(true)
  })

  it('returns true for supported read versions', () => {
    expect(isVersionSupported('0.9', '1.0', ['0.9'])).toBe(true)
    expect(isVersionSupported('0.5', '1.0', ['0.5', '0.6', '0.9'])).toBe(true)
  })

  it('returns false for unsupported versions', () => {
    expect(isVersionSupported('0.9', '1.0', [])).toBe(false)
    expect(isVersionSupported('2.0', '1.0', ['0.9', '1.0'])).toBe(false)
  })
})

describe('needsMigration', () => {
  it('returns false for current version', () => {
    expect(needsMigration('1.0', '1.0')).toBe(false)
  })

  it('returns true for older version', () => {
    expect(needsMigration('0.9', '1.0')).toBe(true)
    expect(needsMigration('1.0', '2.0')).toBe(true)
  })
})

describe('formatContractVersion', () => {
  it('formats parsed version to string', () => {
    expect(formatContractVersion({ major: 1, minor: 0 })).toBe('1.0')
    expect(formatContractVersion({ major: 2, minor: 3 })).toBe('2.3')
    expect(formatContractVersion({ major: 0, minor: 0 })).toBe('0.0')
  })
})

describe('bumpMajor / bumpMinor', () => {
  it('bumps major version, resets minor to 0', () => {
    expect(bumpMajor('1.5')).toBe('2.0')
    expect(bumpMajor('2.0')).toBe('3.0')
  })

  it('bumps minor version', () => {
    expect(bumpMinor('1.0')).toBe('1.1')
    expect(bumpMinor('1.9')).toBe('1.10')
    expect(bumpMinor('2.3')).toBe('2.4')
  })
})

describe('schemaVersionToContractVersion / contractVersionToSchemaVersion', () => {
  it('converts between schema and contract versions', () => {
    expect(schemaVersionToContractVersion(1)).toBe('1.0')
    expect(schemaVersionToContractVersion(5)).toBe('5.0')
    expect(contractVersionToSchemaVersion('1.0')).toBe(1)
    expect(contractVersionToSchemaVersion('5.3')).toBe(5)
  })
})

// =============================================================================
// 2. 变更分类测试（§2.2）
// =============================================================================

describe('CHANGE_KIND_ORDER', () => {
  it('additive < deprecating < breaking', () => {
    expect(CHANGE_KIND_ORDER.additive).toBeLessThan(CHANGE_KIND_ORDER.deprecating)
    expect(CHANGE_KIND_ORDER.deprecating).toBeLessThan(CHANGE_KIND_ORDER.breaking)
  })
})

// =============================================================================
// 3. 契约目录验证测试（§1.4）
// =============================================================================

describe('validateCatalogEntry', () => {
  const validEntry: ContractCatalogEntry = {
    contractId: 'test-contract-v1',
    owner: 'test-team',
    kind: 'wire',
    currentVersion: '1.0',
    supportedReadVersions: [],
    securityClass: 'internal',
    adoptionState: 'adopted',
    description: '测试契约',
    registeredAt: '2026-07-17',
    consumers: ['packages/types/src/test.ts'],
  }

  it('passes for valid entry', () => {
    const result = validateCatalogEntry(validEntry)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects empty contractId', () => {
    const result = validateCatalogEntry({ ...validEntry, contractId: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('contractId'))).toBe(true)
  })

  it('rejects invalid currentVersion', () => {
    const result = validateCatalogEntry({ ...validEntry, currentVersion: 'invalid' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('currentVersion'))).toBe(true)
  })

  it('rejects invalid supportedReadVersion', () => {
    const result = validateCatalogEntry({
      ...validEntry,
      supportedReadVersions: ['bad-version'],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('supportedReadVersion'))).toBe(true)
  })

  it('rejects unsupported kind', () => {
    const result = validateCatalogEntry({
      ...validEntry,
      kind: 'unknown' as ContractKind,
    })
    expect(result.valid).toBe(false)
  })

  it('rejects unsupported securityClass', () => {
    const result = validateCatalogEntry({
      ...validEntry,
      securityClass: 'top_secret' as SecurityClass,
    })
    expect(result.valid).toBe(false)
  })

  it('rejects unsupported adoptionState', () => {
    const result = validateCatalogEntry({
      ...validEntry,
      adoptionState: 'unknown' as AdoptionState,
    })
    expect(result.valid).toBe(false)
  })

  it('warns when supportedReadVersions includes currentVersion', () => {
    const result = validateCatalogEntry({
      ...validEntry,
      supportedReadVersions: ['1.0'],
    })
    expect(result.warnings.some((w) => w.includes('supportedReadVersions'))).toBe(true)
  })

  // §2.4: test unknown optional fields are OK (catalog doesn't have unknown required fields)
  it('rejects supportedReadVersion with major > currentVersion', () => {
    const result = validateCatalogEntry({
      ...validEntry,
      supportedReadVersions: ['2.0'],
    })
    expect(result.valid).toBe(false)
  })
})

describe('validateCatalog', () => {
  it('passes for CONTRACT_CATALOG', () => {
    const result = validateCatalog(CONTRACT_CATALOG)
    expect(result.valid).toBe(true)
  })

  it('detects key mismatch', () => {
    const badCatalog: ContractCatalog = {
      'key-a': {
        contractId: 'key-b', // mismatch
        owner: 'test',
        kind: 'wire',
        currentVersion: '1.0',
        supportedReadVersions: [],
        securityClass: 'internal',
        adoptionState: 'adopted',
        description: 'test',
        registeredAt: '2026-07-17',
        consumers: [],
      },
    }
    const result = validateCatalog(badCatalog)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('does not match'))).toBe(true)
  })
})

// =============================================================================
// 4. 首批契约目录验证（§1.2）
// =============================================================================

describe('CONTRACT_CATALOG entries', () => {
  it('contains ai-draft-stream-v1', () => {
    const entry = CONTRACT_CATALOG['ai-draft-stream-v1']
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('wire')
    expect(entry.adoptionState).toBe('pending_adoption')
  })

  it('contains compiler-stage-event-v1', () => {
    const entry = CONTRACT_CATALOG['compiler-stage-event-v1']
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('wire')
    expect(entry.adoptionState).toBe('pending_adoption')
  })

  it('contains renderer-config-v1', () => {
    const entry = CONTRACT_CATALOG['renderer-config-v1']
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('config')
    expect(entry.adoptionState).toBe('adopted')
  })

  it('contains diagram-spec-v1', () => {
    const entry = CONTRACT_CATALOG['diagram-spec-v1']
    expect(entry).toBeDefined()
    expect(entry.kind).toBe('wire')
    expect(entry.adoptionState).toBe('adopted')
  })

  it('all entries pass validation', () => {
    for (const [id, entry] of Object.entries(CONTRACT_CATALOG)) {
      const result = validateCatalogEntry(entry)
      if (!result.valid) {
        console.error(`Catalog entry "${id}" validation failed:`, result.errors)
      }
      expect(result.valid, `Entry "${id}" should be valid`).toBe(true)
    }
  })
})

// =============================================================================
// 5. 兼容错误测试（§2.3、§2.5）
// =============================================================================

describe('CompatibilityError', () => {
  it('has correct properties', () => {
    const err = new CompatibilityError({
      code: 'UNSUPPORTED_CONTRACT_VERSION',
      message: 'test error',
      contractId: 'test-v1',
      version: '1.0',
      correlationId: 'corr-123',
    })
    expect(err.name).toBe('CompatibilityError')
    expect(err.code).toBe('UNSUPPORTED_CONTRACT_VERSION')
    expect(err.message).toBe('test error')
    expect(err.contractId).toBe('test-v1')
    expect(err.version).toBe('1.0')
    expect(err.correlationId).toBe('corr-123')
  })

  it('toSafeJSON does not contain payload/prompt/token/secret/organization data', () => {
    const err = unsupportedContractVersion('test-v1', '2.0', 'corr-abc')
    const safe = err.toSafeJSON()

    expect(safe.code).toBe('UNSUPPORTED_CONTRACT_VERSION')
    expect(safe.contractId).toBe('test-v1')
    expect(safe.version).toBe('2.0')
    expect(safe.correlationId).toBe('corr-abc')

    // §2.5: 确保不包含敏感字段
    expect(safe).not.toHaveProperty('payload')
    expect(safe).not.toHaveProperty('prompt')
    expect(safe).not.toHaveProperty('token')
    expect(safe).not.toHaveProperty('secret')
    expect(safe).not.toHaveProperty('organizationData')
    expect(safe).not.toHaveProperty('data')
  })
})

describe('factory functions', () => {
  it('unsupportedContractVersion', () => {
    const err = unsupportedContractVersion('c1', '0.5', 'corr-1')
    expect(err.code).toBe('UNSUPPORTED_CONTRACT_VERSION')
    expect(err.contractId).toBe('c1')
    expect(err.version).toBe('0.5')
  })

  it('missingRequiredVersion', () => {
    const err = missingRequiredVersion('c1', 'corr-1')
    expect(err.code).toBe('MISSING_REQUIRED_VERSION')
    expect(err.contractId).toBe('c1')
  })

  it('migrationChainBroken', () => {
    const err = migrationChainBroken('c1', '0.5', '1.0', 'corr-1')
    expect(err.code).toBe('MIGRATION_CHAIN_BROKEN')
    expect(err.contractId).toBe('c1')
    expect(err.version).toBe('0.5')
  })

  it('organizationContextMissing', () => {
    const err = organizationContextMissing('c1', 'corr-1')
    expect(err.code).toBe('ORGANIZATION_CONTEXT_MISSING')
  })

  it('organizationContextMismatch', () => {
    const err = organizationContextMismatch('c1', 'org-1', 'org-2', 'corr-1')
    expect(err.code).toBe('ORGANIZATION_CONTEXT_MISMATCH')
    expect(err.details).toContain('org-1')
    expect(err.details).toContain('org-2')
  })
})

// =============================================================================
// 6. 迁移适配器注册表测试（§3.1、§3.2、§3.3、§3.4、§3.5）
// =============================================================================

describe('MigrationAdapterRegistry', () => {
  let registry: MigrationAdapterRegistry

  beforeEach(() => {
    registry = new MigrationAdapterRegistry()
  })

  // §3.1: 注册适配器
  it('registers and retrieves adapters', () => {
    const adapter: MigrationAdapter = {
      contractId: 'test-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data) => ({ success: true, data }),
    }
    registry.register(adapter)
    expect(registry.listAdapters('test-v1')).toHaveLength(1)
    expect(registry.hasPath('test-v1', '1.0', '2.0')).toBe(true)
  })

  // §3.2: 迁移链解析
  it('resolves chain with multiple steps', () => {
    registry.register({
      contractId: 'chain-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data: Record<string, unknown>) => ({
        success: true,
        data: { ...data, migrated1: true },
      }),
    })
    registry.register({
      contractId: 'chain-v1',
      fromVersion: '2.0',
      toVersion: '3.0',
      migrate: (data: Record<string, unknown>) => ({
        success: true,
        data: { ...data, migrated2: true },
      }),
    })

    const chain = registry.resolveChain('chain-v1', '1.0', '3.0')
    expect(chain).toHaveLength(2)
  })

  // §3.2: 链式迁移执行
  it('executes chained migration correctly', () => {
    registry.register({
      contractId: 'exec-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data: Record<string, unknown>) => ({
        success: true,
        data: { ...data, step: 1 },
      }),
    })
    registry.register({
      contractId: 'exec-v1',
      fromVersion: '2.0',
      toVersion: '3.0',
      migrate: (data: Record<string, unknown>) => ({
        success: true,
        data: { ...data, step: (data.step as number) + 1 },
      }),
    })

    const result = registry.migrate('exec-v1', { initial: true }, '1.0', '3.0')
    expect(result.success).toBe(true)
    expect((result.data as Record<string, unknown>).step).toBe(2)
    expect((result.data as Record<string, unknown>).initial).toBe(true)
  })

  // §3.3: 重复注册拒绝
  it('rejects duplicate registration', () => {
    const adapter: MigrationAdapter = {
      contractId: 'dup-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data) => ({ success: true, data }),
    }
    registry.register(adapter)
    expect(() => registry.register(adapter)).toThrow(/Duplicate/)
    expect(() => registry.register(adapter)).toThrow(CompatibilityError)
  })

  // §3.3: 迁移链缺口拒绝
  it('throws on chain gap', () => {
    registry.register({
      contractId: 'gap-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data) => ({ success: true, data }),
    })
    // 从 1.0 到 3.0 需经过 2.0，但缺少 2.0→3.0
    expect(() => registry.resolveChain('gap-v1', '1.0', '3.0')).toThrow()
  })

  // §3.3: 非 current writer 拒绝（向前迁移不支持的版本方向）
  it('rejects backward migration', () => {
    registry.register({
      contractId: 'back-v1',
      fromVersion: '2.0',
      toVersion: '3.0',
      migrate: (data) => ({ success: true, data }),
    })
    // 不允许从 3.0 迁移到 2.0（向下迁移）
    expect(() => registry.resolveChain('back-v1', '3.0', '2.0')).toThrow()
  })

  // §3.3: 环路检测
  it('detects cycles', () => {
    expect(registry.detectCycle('empty')).toBe(false)

    registry.register({
      contractId: 'cycle-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data) => ({ success: true, data }),
    })
    expect(registry.detectCycle('cycle-v1')).toBe(false)

    // 注册反向路径形成环
    registry.register({
      contractId: 'cycle-v1',
      fromVersion: '2.0',
      toVersion: '1.0',
      migrate: (data) => ({ success: true, data }),
    })
    expect(registry.detectCycle('cycle-v1')).toBe(true)
  })

  // §3.4: 适配器幂等性
  it('adapter idempotency - applying migration twice gives same result', () => {
    registry.register({
      contractId: 'idem-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data: Record<string, unknown>) => ({
        success: true,
        data: { ...data, version: '2.0', migrated: true },
      }),
    })

    const result1 = registry.migrate('idem-v1', { name: 'test', version: '1.0' }, '1.0', '2.0')
    expect(result1.success).toBe(true)

    // 迁移后的数据再"迁移"一遍（已标记 migrated 也不应改变结果语义）
    const result2 = registry.migrate('idem-v1', result1.data, '1.0', '2.0')
    expect(result2.success).toBe(true)
    expect((result2.data as Record<string, unknown>).migrated).toBe(true)
    expect((result2.data as Record<string, unknown>).name).toBe('test')
  })

  // §3.4: 没有输入突变（adapter 不修改入参）
  it('does not mutate input data', () => {
    registry.register({
      contractId: 'no-mut-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data: Record<string, unknown>) => ({
        success: true,
        data: { ...data, newField: 'added' },
      }),
    })

    const input = { name: 'test', version: '1.0' }
    const inputCopy = { ...input }
    registry.migrate('no-mut-v1', input, '1.0', '2.0')

    // 原始输入不应改变
    expect(input).toEqual(inputCopy)
    expect(input).not.toHaveProperty('newField')
  })

  // §3.4: 重复迁移（多次调用迁移不影响最终状态）
  it('repeated migration produces stable result', () => {
    registry.register({
      contractId: 'repeat-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data: Record<string, unknown>) => ({
        success: true,
        data: { ...data, field: 'value' },
      }),
    })

    const r1 = registry.migrate('repeat-v1', { x: 1 }, '1.0', '2.0')
    const r2 = registry.migrate('repeat-v1', { x: 1 }, '1.0', '2.0')
    expect(r1.data).toEqual(r2.data)
  })

  // §3.5: 组织上下文缺失拒绝
  it('migration with organization context missing is detected', () => {
    registry.register({
      contractId: 'org-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data: Record<string, unknown>, context?: MigrationContext) => {
        if (!context?.organizationId) {
          return {
            success: false,
            data,
            error: 'Organization context is required',
          }
        }
        return { success: true, data: { ...data, orgId: context.organizationId } }
      },
    })

    const result = registry.migrate('org-v1', { name: 'test' }, '1.0', '2.0')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Organization')
  })

  // §3.5: 组织上下文不匹配拒绝
  it('migration with organization context mismatch is detected', () => {
    registry.register({
      contractId: 'org-mismatch-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data: Record<string, unknown>, context?: MigrationContext) => {
        const existingOrg = data.orgId as string | undefined
        if (existingOrg && context?.organizationId && existingOrg !== context.organizationId) {
          return {
            success: false,
            data,
            error: `Organization mismatch: expected ${existingOrg}, got ${context.organizationId}`,
          }
        }
        return { success: true, data }
      },
    })

    const result = registry.migrate(
      'org-mismatch-v1',
      { name: 'test', orgId: 'org-a' },
      '1.0',
      '2.0',
      { organizationId: 'org-b' },
    )
    expect(result.success).toBe(false)
  })

  // §3.5: AI 待确认状态在上下文中保留
  it('preserves pending confirmation state when context flag is set', () => {
    registry.register({
      contractId: 'ai-pending-v1',
      fromVersion: '1.0',
      toVersion: '2.0',
      migrate: (data: Record<string, unknown>, context?: MigrationContext) => {
        const hasPending = data.pendingConfirmation === true
        if (hasPending && context?.preservePendingConfirmation) {
          // 保留 pending 字段
          return { success: true, data: { ...data, migrated: true } }
        }
        // 没有 preserve 时允许清理
        const { pendingConfirmation, ...rest } = data as Record<string, unknown>
        return { success: true, data: { ...rest, migrated: true } }
      },
    })

    const input = { name: 'ai-suggestion', pendingConfirmation: true }

    // preservePendingConfirmation = true → pending 字段保留
    const result1 = registry.migrate('ai-pending-v1', input, '1.0', '2.0', {
      preservePendingConfirmation: true,
    })
    expect(result1.success).toBe(true)
    expect((result1.data as Record<string, unknown>).pendingConfirmation).toBe(true)

    // preservePendingConfirmation = false → pending 字段可被清理
    const result2 = registry.migrate('ai-pending-v1', input, '1.0', '2.0', {
      preservePendingConfirmation: false,
    })
    expect(result2.success).toBe(true)
  })
})

// =============================================================================
// 7. 全局单例测试
// =============================================================================

describe('globalMigrationRegistry', () => {
  it('is a MigrationAdapterRegistry instance', () => {
    expect(globalMigrationRegistry).toBeInstanceOf(MigrationAdapterRegistry)
  })
})

// =============================================================================
// 8. 安全测试（§2.5）
// =============================================================================

describe('error and log safety (§2.5)', () => {
  it('CompatibilityError toSafeJSON never includes payload/prompt/token/secret', () => {
    const errors = [
      unsupportedContractVersion('c1', '1.0', 'corr-1'),
      missingRequiredVersion('c2', 'corr-2'),
      migrationChainBroken('c3', '1.0', '2.0', 'corr-3'),
      organizationContextMissing('c4', 'corr-4'),
      organizationContextMismatch('c5', 'org-a', 'org-b', 'corr-5'),
    ]

    for (const err of errors) {
      const safe = err.toSafeJSON()
      const keys = Object.keys(safe)
      // 白名单：只有这些键允许出现
      const allowedKeys = ['code', 'message', 'contractId', 'version', 'correlationId', 'details']
      for (const key of keys) {
        expect(allowedKeys.includes(key), `Key "${key}" should not appear in safe JSON`).toBe(true)
      }
    }
  })

  it('toSafeJSON correlationId is stable identifier, not payload', () => {
    const err = unsupportedContractVersion('c1', '1.0', 'corr-abc-123')
    const safe = err.toSafeJSON()
    expect(safe.correlationId).toBe('corr-abc-123')
    // Ensure it's just a correlation ID, not containing real data
    expect(typeof safe.correlationId).toBe('string')
    expect((safe.correlationId as string).length).toBeLessThan(100)
  })
})

// =============================================================================
// 9. 缺失版本/未来 major/非法版本测试（§2.4）
// =============================================================================

describe('missing/future/illegal version handling (§2.4)', () => {
  it('parseContractVersion throws on missing version', () => {
    expect(() => parseContractVersion('' as string)).toThrow()
    expect(() => parseContractVersion(null as unknown as string)).toThrow()
    expect(() => parseContractVersion(undefined as unknown as string)).toThrow()
  })

  it('compareContractVersions handles future major correctly', () => {
    expect(compareContractVersions('1.0', '100.0')).toBe('lt')
    expect(compareContractVersions('99.0', '1.0')).toBe('gt')
  })

  it('isVersionSupported returns false for future major not in supported list', () => {
    expect(isVersionSupported('2.0', '1.0', ['0.9'])).toBe(false)
  })
})
