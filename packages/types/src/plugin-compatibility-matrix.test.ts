import { describe, expect, it } from 'vitest'
import {
  comparePluginSemver,
  computePluginCompatibilityDigest,
  detectPluginBreakingChanges,
  evaluatePluginCompatibility,
  evaluatePluginReleaseApprovalCompatibility,
  normalizePluginCompatibilityReason,
  projectPluginCompatibilityAudit,
  satisfiesPluginVersionRange,
  type HostPluginContractSnapshot,
  type PluginCompatibilityDeclaration,
  type PluginCapabilitySeamEntry,
} from './index.js'

const seam: PluginCapabilitySeamEntry = {
  seamKey: 'server-query.readonly-provider',
  seamVersion: '1.2.0',
  title: 'query',
  surface: 'server-query',
  classification: 'plugin',
  deliveryStatus: 'implemented',
  ownerRef: 'platform-core',
  contractRefs: ['plugin-server-hook-runtime'],
  evidenceRefs: [],
  evidenceFreshness: 'current',
  operationModes: ['query'],
  inputContractRef: 'query-in',
  outputContractRef: 'query-out',
  compatibilityPolicy: 'same-major',
  failureMode: 'isolate-drop',
  scopeModes: ['organization'],
  requiredPermissions: ['project:view'],
  dataOwnership: 'host-owned',
  sideEffectClass: 'read-only',
  confirmationPolicy: 'not-required',
  auditPolicy: 'host-audit',
  networkPolicy: 'none',
  availability: 'host-ready',
}

const host: HostPluginContractSnapshot = {
  hostVersion: '3.2.0',
  manifestSchemaVersions: ['1.0'],
  permissionModelVersion: '1.0',
  distributionChannels: ['stable'],
  seams: [seam],
}

const declaration: PluginCompatibilityDeclaration = {
  pluginVersion: '1.1.0',
  hostRange: '>=3.0.0 <4.0.0',
  manifestSchemaVersion: '1.0',
  permissionModelVersion: '1.0',
  channel: 'stable',
  requiredSeams: [{ seamKey: seam.seamKey, seamVersion: '1.0.0' }],
}

describe('plugin compatibility matrix', () => {
  it('uses conservative stable/prerelease SemVer rules', () => {
    expect(comparePluginSemver('1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(comparePluginSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(satisfiesPluginVersionRange('3.2.0', '>=3.0.0 <4.0.0')).toBe(true)
    expect(satisfiesPluginVersionRange('4.0.0', '^3.1.0')).toBe(false)
  })

  it('returns deterministic compatible verdict and digest', () => {
    const first = evaluatePluginCompatibility(host, declaration)
    const second = evaluatePluginCompatibility(host, {
      ...declaration,
      requiredSeams: [...declaration.requiredSeams].reverse(),
    })
    expect(first.verdict).toBe('compatible')
    expect(first.compatible).toBe(true)
    expect(first.digest).toBe(second.digest)
  })

  it('fails closed for prerelease, old host, unknown seam and unsupported permission model', () => {
    const result = evaluatePluginCompatibility(
      { ...host, hostVersion: '2.9.0' },
      {
        ...declaration,
        pluginVersion: '2.0.0-beta.1',
        permissionModelVersion: '2.0',
        requiredSeams: [{ seamKey: 'unknown.seam', seamVersion: '1.0.0' }],
      },
    )
    expect(result.compatible).toBe(false)
    expect(result.reasons.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'host-version-out-of-range',
        'permission-model-unsupported',
        'prerelease-not-allowed',
        'seam-unknown',
      ]),
    )
  })

  it('requires migration and rollback references', () => {
    const missing = evaluatePluginCompatibility(host, {
      ...declaration,
      migrations: [{ id: 'm1', fromVersion: '1.0.0', toVersion: '2.0.0', reversible: false }],
    })
    expect(missing.compatible).toBe(false)
    expect(missing.reasons.map((item) => item.code)).toEqual(
      expect.arrayContaining(['migration-missing', 'rollback-missing']),
    )

    const declared = evaluatePluginCompatibility(host, {
      ...declaration,
      migrations: [
        {
          id: 'm1',
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          reversible: true,
          migrationRef: 'docs/plugin-migrations.md#m1',
          rollbackRef: 'docs/plugin-migrations.md#m1-rollback',
        },
      ],
    })
    expect(declared.verdict).toBe('migration-required')
    expect(declared.compatible).toBe(true)
  })

  it('detects removed fields/capabilities/enums, permission elevation and rollback gaps', () => {
    const result = detectPluginBreakingChanges(
      {
        pluginId: 'com.aiproj.demo',
        version: '1.0.0',
        requiredFields: ['title', 'status'],
        capabilities: ['query', 'preview'],
        permissions: ['project:view'],
        enums: { status: ['active', 'disabled'] },
      },
      {
        pluginId: 'com.aiproj.demo',
        version: '2.0.0',
        requiredFields: ['title'],
        capabilities: ['query'],
        permissions: ['project:view', 'project:update'],
        enums: { status: ['active'] },
        migrationRef: 'docs/migrate.md',
        reversible: false,
      },
    )
    expect(result.breaking).toBe(true)
    expect(result.findings.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        'required-field-removed',
        'capability-narrowed',
        'permission-elevated',
        'enum-value-removed',
        'irreversible-migration',
        'rollback-missing',
      ]),
    )
    expect(result.digest).toBe(
      computePluginCompatibilityDigest({
        before: {
          pluginId: 'com.aiproj.demo',
          version: '1.0.0',
          requiredFields: ['title', 'status'],
          capabilities: ['query', 'preview'],
          permissions: ['project:view'],
          enums: { status: ['active', 'disabled'] },
        },
        after: {
          pluginId: 'com.aiproj.demo',
          version: '2.0.0',
          requiredFields: ['title'],
          capabilities: ['query'],
          permissions: ['project:view', 'project:update'],
          enums: { status: ['active'] },
          migrationRef: 'docs/migrate.md',
          reversible: false,
        },
        findings: result.findings,
      }),
    )
  })

  it('projects only stable low-sensitivity audit fields and normalizes unknown reasons', () => {
    const projection = projectPluginCompatibilityAudit(
      evaluatePluginCompatibility(host, declaration),
    )
    expect(Object.keys(projection).sort()).toEqual([
      'compatibilityDigest',
      'fieldPaths',
      'reasonCodes',
      'verdict',
    ])
    expect(JSON.stringify(projection)).not.toMatch(/token|secret|password/i)
    expect(normalizePluginCompatibilityReason('provider said secret=abc')).toBe('input-unknown')
  })

  it('release approval rejects missing host range and binds handled breaking changes to a digest', () => {
    const missing = evaluatePluginReleaseApprovalCompatibility({ host })
    expect(missing.allowed).toBe(false)
    expect(missing.reasonCodes).toEqual(['input-unknown'])

    const breakingChange = {
      before: {
        pluginId: 'com.aiproj.demo',
        version: '1.0.0',
        requiredFields: ['title'],
        capabilities: ['query'],
        permissions: ['project:view'],
      },
      after: {
        pluginId: 'com.aiproj.demo',
        version: '2.0.0',
        requiredFields: [],
        capabilities: ['query'],
        permissions: ['project:view'],
        migrationRef: 'docs/migrate.md',
        rollbackRef: 'docs/rollback.md',
        reversible: true,
      },
    }
    const blocked = evaluatePluginReleaseApprovalCompatibility({
      host,
      declaration,
      breakingChange,
    })
    expect(blocked.allowed).toBe(false)
    expect(blocked.reasonCodes).toContain('breaking-change-unhandled')

    const acknowledged = evaluatePluginReleaseApprovalCompatibility({
      host,
      declaration,
      breakingChange: { ...breakingChange, handledDigest: blocked.breakingChanges!.digest },
    })
    expect(acknowledged.allowed).toBe(true)
  })

  /**
   * 损坏声明必须 fail-closed。
   *
   * release metadata 是持久化数据，可能因手工改库、旧版本写入或字段裁剪而残缺。
   * 评估器是审批 / 目录投影 / 安装预览的共用入口，任何 throw 都会把一条脏行
   * 放大成整页 500；契约是「判 allowed:false 并给出 reason code」。
   */
  it('损坏或残缺的兼容性声明一律 fail-closed 且不抛出', () => {
    const brokenDeclarations: unknown[] = [
      {}, // 全空
      { pluginVersion: '1.0.0' }, // 缺 hostRange
      { ...declaration, hostRange: undefined },
      { ...declaration, hostRange: 123 },
      { ...declaration, pluginVersion: null },
      { ...declaration, requiredSeams: undefined },
      { ...declaration, requiredSeams: 'server-query.readonly-provider' },
      { ...declaration, dependencies: 'nope' },
      { ...declaration, migrations: 7 },
      'not-an-object',
      null,
    ]
    for (const broken of brokenDeclarations) {
      const result = evaluatePluginReleaseApprovalCompatibility({
        host,
        declaration: broken as PluginCompatibilityDeclaration,
      })
      expect(result.allowed).toBe(false)
      expect(result.reasonCodes.length).toBeGreaterThan(0)
      expect(result.digest).toMatch(/^sha256:/)
    }

    // 纯函数层同样不得抛：非字符串输入判不可解析
    expect(satisfiesPluginVersionRange('1.0.0', undefined as unknown as string)).toBe(false)
    expect(satisfiesPluginVersionRange(undefined as unknown as string, '>=1.0.0')).toBe(false)
    expect(comparePluginSemver(undefined as unknown as string, '1.0.0')).toBe(0)
  })
})
