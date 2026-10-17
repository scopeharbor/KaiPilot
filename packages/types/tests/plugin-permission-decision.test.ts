// v3-plugin-permission-audit-and-observation 契约测试
// Tasks 2.2 / 2.4 / 2.6 / 2.8 / 2.10 / 2.12 / 2.13
//
// 覆盖：枚举完整性、fail-closed、二元授权、type guard、prerequisite profiles、
// reason priority、deterministic decision id/fingerprint、permutation invariance、
// low-sensitivity serialization、fixture coverage、barrel import smoke。
import { describe, it, expect } from 'vitest'
import {
  // Enums & constants
  PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION,
  PLUGIN_PERMISSION_DECISION_MODES,
  PLUGIN_PERMISSION_DECISION_OPERATIONS,
  PLUGIN_PERMISSION_DECISION_OUTCOMES,
  PLUGIN_PERMISSION_REASON_CODES,
  PLUGIN_PERMISSION_PREREQUISITE_PROFILES,
  PLUGIN_PERMISSION_OBSERVATION_FINDING_STATUSES,
  PLUGIN_PERMISSION_OBSERVATION_STATUSES,
  // Type guards
  isPluginPermissionDecisionMode,
  isPluginPermissionDecisionOperation,
  isPluginPermissionDecisionOutcome,
  isPluginPermissionReasonCode,
  isPluginPermissionPrerequisiteProfile,
  isPluginPermissionObservationFindingStatus,
  isPluginPermissionObservationStatus,
  // Helpers
  pdFnv1aHash,
  pdStableSerialize,
  pdDomainSeparatedHash,
  pdNormalizePermissionRefs,
  pdComputeDecisionId,
  pdComputeInputFingerprint,
  pdDeriveReasonPriority,
  pdGetProfilePrerequisites,
  pdEvaluatePrerequisites,
  // Types
  type PluginPermissionRequestedRef,
  type PluginPermissionGrantedRef,
  type PluginPermissionDecisionMode,
  type PluginPermissionDecisionOperation,
  type PluginPermissionDecisionOutcome,
  type PluginPermissionReasonCode,
} from '../src/plugin-permission-decision.js'
import {
  PLUGIN_PERMISSION_DECISION_FIXTURES,
  PLUGIN_PERMISSION_DECISION_FIXTURE_IDS,
  PLUGIN_PERMISSION_DECISION_RULE_FAMILIES,
  FIXTURE_TO_RULE_FAMILY,
  FIXTURE_EXPECTED_ASSERTIONS,
  FIXTURE_ALLOW_HAPPY_PATH,
  FIXTURE_DENY_RBAC,
  FIXTURE_DENY_GRANT_ESCALATION,
  FIXTURE_DENY_REPLAY,
  FIXTURE_DENY_AUDIT_FAILURE,
  FIXTURE_DENY_SCOPE_MISMATCH,
  FIXTURE_SENSITIVE_REDACTED,
} from '../src/plugin-permission-decision-fixtures.js'

// ═══════════════════════════════════════════════════════════════
// Task 2.2: 枚举完整性 & fail-closed
// ═══════════════════════════════════════════════════════════════

describe('Task 2.2 — enum completeness & fail-closed', () => {
  it('schema version is "1"', () => {
    expect(PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION).toBe('1')
  })

  it('all first-period operations are valid', () => {
    const expectedOps = [
      'register-install',
      'enable',
      'disable',
      'upgrade',
      'uninstall',
      'resolve-query',
      'execute',
      'command-proposal',
      'ui-slot',
      'skill-adapter',
      'compiler-contribution',
    ]
    expect(PLUGIN_PERMISSION_DECISION_OPERATIONS).toEqual(expectedOps)
  })

  it('unknown mode fails type guard', () => {
    expect(isPluginPermissionDecisionMode('unknown')).toBe(false)
    expect(isPluginPermissionDecisionMode(null)).toBe(false)
    expect(isPluginPermissionDecisionMode(42)).toBe(false)
    expect(isPluginPermissionDecisionMode('host-administration')).toBe(true)
    expect(isPluginPermissionDecisionMode('plugin-runtime')).toBe(true)
  })

  it('unknown operation fails type guard', () => {
    expect(isPluginPermissionDecisionOperation('unknown-op')).toBe(false)
    expect(isPluginPermissionDecisionOperation('execute')).toBe(true)
    expect(isPluginPermissionDecisionOperation('register-install')).toBe(true)
  })

  it('unknown outcome fails type guard', () => {
    expect(isPluginPermissionDecisionOutcome('degraded')).toBe(false)
    expect(isPluginPermissionDecisionOutcome('allowed')).toBe(true)
    expect(isPluginPermissionDecisionOutcome('denied')).toBe(true)
  })

  it('unknown reason code fails type guard', () => {
    expect(isPluginPermissionReasonCode('made-up-reason')).toBe(false)
    expect(isPluginPermissionReasonCode('rbac-denied')).toBe(true)
    expect(isPluginPermissionReasonCode('audit-unavailable')).toBe(true)
  })

  it('only allowed and denied outcomes — no degraded as executable result', () => {
    expect(PLUGIN_PERMISSION_DECISION_OUTCOMES).toEqual(['allowed', 'denied'])
    expect(PLUGIN_PERMISSION_DECISION_OUTCOMES).toHaveLength(2)
  })

  it('observation degraded is separate from authorization outcome', () => {
    // Observation statuses include degraded, but it's NOT an outcome
    expect(PLUGIN_PERMISSION_OBSERVATION_STATUSES).toContain('degraded')
    expect(PLUGIN_PERMISSION_DECISION_OUTCOMES).not.toContain('degraded')
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.4: Prerequisite profile matrix
// ═══════════════════════════════════════════════════════════════

describe('Task 2.4 — prerequisite profile matrix', () => {
  it('all four profiles exist', () => {
    expect(PLUGIN_PERMISSION_PREREQUISITE_PROFILES).toHaveLength(4)
    expect(PLUGIN_PERMISSION_PREREQUISITE_PROFILES).toContain('host-admin-read')
    expect(PLUGIN_PERMISSION_PREREQUISITE_PROFILES).toContain('host-admin-mutation')
    expect(PLUGIN_PERMISSION_PREREQUISITE_PROFILES).toContain('plugin-runtime-read')
    expect(PLUGIN_PERMISSION_PREREQUISITE_PROFILES).toContain('plugin-runtime-formal-write')
  })

  it('profile type guard works', () => {
    expect(isPluginPermissionPrerequisiteProfile('host-admin-read')).toBe(true)
    expect(isPluginPermissionPrerequisiteProfile('nonexistent')).toBe(false)
  })

  it('host-admin-read requires RBAC + scope', () => {
    const prereqs = pdGetProfilePrerequisites('host-admin-read')
    const names = prereqs.map((p) => p.name)
    expect(names).toContain('rbac-authorized')
    expect(names).toContain('scope-matches')
  })

  it('host-admin-mutation requires RBAC + grant + policy + confirmation', () => {
    const prereqs = pdGetProfilePrerequisites('host-admin-mutation')
    const names = prereqs.map((p) => p.name)
    expect(names).toContain('rbac-authorized')
    expect(names).toContain('grant-valid')
    expect(names).toContain('policy-passes')
    expect(names).toContain('confirmation-not-required')
  })

  it('plugin-runtime-formal-write requires audit-available + confirmation', () => {
    const prereqs = pdGetProfilePrerequisites('plugin-runtime-formal-write')
    const names = prereqs.map((p) => p.name)
    expect(names).toContain('audit-available')
    expect(names).toContain('confirmation-confirmed')
    expect(names).toContain('seam-host-ready')
  })

  it('admin read: missing RBAC → denied', () => {
    const checks = pdEvaluatePrerequisites('host-admin-read', {
      hasValidInstall: true,
      hasValidGrant: false,
      rbacAuthorized: false,
      scopeMatches: true,
      seamHostReady: false,
      policyPasses: false,
      confirmationConfirmed: false,
      auditAvailable: false,
    })
    const rbacCheck = checks.find((c) => c.name === 'rbac-authorized')
    expect(rbacCheck?.passed).toBe(false)
    expect(rbacCheck?.reasonCode).toBe('rbac-denied')
  })

  it('admin mutation: confirmation confirmed → confirmation-not-required fails', () => {
    // confirmation-not-required is an inverted check: it passes when confirmationConfirmed=false
    // When confirmationConfirmed=true, "confirmation-not-required" fails → reason: confirmation-required
    const checks = pdEvaluatePrerequisites('host-admin-mutation', {
      hasValidInstall: true,
      hasValidGrant: true,
      rbacAuthorized: true,
      scopeMatches: true,
      seamHostReady: true,
      policyPasses: true,
      confirmationConfirmed: true, // confirmation IS confirmed → "not-required" fails
      auditAvailable: true,
    })
    const confirmCheck = checks.find((c) => c.name === 'confirmation-not-required')
    expect(confirmCheck?.passed).toBe(false)
    expect(confirmCheck?.reasonCode).toBe('confirmation-required')
  })

  it('runtime read: missing grant → denied', () => {
    const checks = pdEvaluatePrerequisites('plugin-runtime-read', {
      hasValidInstall: true,
      hasValidGrant: false, // missing
      rbacAuthorized: false,
      scopeMatches: true,
      seamHostReady: true,
      policyPasses: false,
      confirmationConfirmed: false,
      auditAvailable: false,
    })
    const grantCheck = checks.find((c) => c.name === 'grant-valid')
    expect(grantCheck?.passed).toBe(false)
    expect(grantCheck?.reasonCode).toBe('grant-missing')
  })

  it('runtime formal-write: missing audit → denied', () => {
    const checks = pdEvaluatePrerequisites('plugin-runtime-formal-write', {
      hasValidInstall: true,
      hasValidGrant: true,
      rbacAuthorized: false,
      scopeMatches: true,
      seamHostReady: true,
      policyPasses: false,
      confirmationConfirmed: true,
      auditAvailable: false, // missing
    })
    const auditCheck = checks.find((c) => c.name === 'audit-available')
    expect(auditCheck?.passed).toBe(false)
    expect(auditCheck?.reasonCode).toBe('audit-unavailable')
  })

  it('all prerequisites pass → all checks passed', () => {
    const checks = pdEvaluatePrerequisites('plugin-runtime-formal-write', {
      hasValidInstall: true,
      hasValidGrant: true,
      rbacAuthorized: true,
      scopeMatches: true,
      seamHostReady: true,
      policyPasses: true,
      confirmationConfirmed: true,
      auditAvailable: true,
    })
    expect(checks.every((c) => c.passed)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.6: Deterministic helpers & permutation invariance
// ═══════════════════════════════════════════════════════════════

describe('Task 2.6 — deterministic helpers & permutation invariance', () => {
  it('fnv1a hash is deterministic', () => {
    const a = pdFnv1aHash('hello world')
    const b = pdFnv1aHash('hello world')
    expect(a).toBe(b)
    expect(typeof a).toBe('string')
    expect(a.length).toBe(8) // 32-bit hex
  })

  it('fnv1a hash changes on different input', () => {
    const a = pdFnv1aHash('hello')
    const b = pdFnv1aHash('world')
    expect(a).not.toBe(b)
  })

  it('stable serialize is deterministic with key order', () => {
    const obj = { z: 1, a: 2, m: 3 }
    const s1 = pdStableSerialize(obj)
    const s2 = pdStableSerialize(obj)
    expect(s1).toBe(s2)
    // Keys should be sorted
    expect(s1).toBe('{"a":2,"m":3,"z":1}')
  })

  it('stable serialize handles arrays', () => {
    const arr = [3, 1, 2]
    expect(pdStableSerialize(arr)).toBe('[3,1,2]')
  })

  it('domain separated hash includes domain', () => {
    const h1 = pdDomainSeparatedHash('decision', 'input')
    const h2 = pdDomainSeparatedHash('fingerprint', 'input')
    expect(h1).not.toBe(h2) // Different domains → different hashes
  })

  it('normalize permission refs produces canonical ordering', () => {
    const input: {
      requested: PluginPermissionRequestedRef[]
      granted: PluginPermissionGrantedRef[]
    } = {
      requested: [
        { permissionKey: 'b.write', scopeKind: 'project' },
        { permissionKey: 'a.read', scopeKind: 'organization' },
      ],
      granted: [
        {
          grantId: 'g2',
          permissionKey: 'b.write',
          scopeBinding: { organizationScope: 'org' },
          expired: false,
          revoked: false,
        },
        {
          grantId: 'g1',
          permissionKey: 'a.read',
          scopeBinding: { organizationScope: 'org' },
          expired: false,
          revoked: false,
        },
      ],
    }
    const normalized = pdNormalizePermissionRefs(input)
    expect(normalized.requested[0].permissionKey).toBe('a.read')
    expect(normalized.requested[1].permissionKey).toBe('b.write')
    expect(normalized.granted[0].grantId).toBe('g1')
    expect(normalized.granted[1].grantId).toBe('g2')
  })

  it('decision id is deterministic for same input', () => {
    const input = {
      schemaVersion: '1',
      organizationScope: 'org-abc',
      mode: 'plugin-runtime' as PluginPermissionDecisionMode,
      operation: 'execute' as PluginPermissionDecisionOperation,
      targetRef: 'target:123',
      requested: [
        { permissionKey: 'read', scopeKind: 'project' },
      ] as PluginPermissionRequestedRef[],
      granted: [
        {
          grantId: 'g1',
          permissionKey: 'read',
          scopeBinding: { organizationScope: 'org-abc' },
          expired: false,
          revoked: false,
        },
      ] as PluginPermissionGrantedRef[],
      idempotencyKey: 'idem-001',
    }
    const id1 = pdComputeDecisionId(input)
    const id2 = pdComputeDecisionId(input)
    expect(id1).toBe(id2)
  })

  it('decision id changes when scope changes', () => {
    const base = {
      schemaVersion: '1',
      organizationScope: 'org-abc',
      mode: 'plugin-runtime' as PluginPermissionDecisionMode,
      operation: 'execute' as PluginPermissionDecisionOperation,
      targetRef: 'target:123',
      requested: [
        { permissionKey: 'read', scopeKind: 'project' },
      ] as PluginPermissionRequestedRef[],
      granted: [
        {
          grantId: 'g1',
          permissionKey: 'read',
          scopeBinding: { organizationScope: 'org-abc' },
          expired: false,
          revoked: false,
        },
      ] as PluginPermissionGrantedRef[],
      idempotencyKey: 'idem-001',
    }
    const id1 = pdComputeDecisionId(base)
    const id2 = pdComputeDecisionId({ ...base, organizationScope: 'org-xyz' })
    expect(id1).not.toBe(id2)
  })

  it('decision id changes when permission changes', () => {
    const base = {
      schemaVersion: '1',
      organizationScope: 'org-abc',
      mode: 'plugin-runtime' as PluginPermissionDecisionMode,
      operation: 'execute' as PluginPermissionDecisionOperation,
      targetRef: 'target:123',
      requested: [
        { permissionKey: 'read', scopeKind: 'project' },
      ] as PluginPermissionRequestedRef[],
      granted: [
        {
          grantId: 'g1',
          permissionKey: 'read',
          scopeBinding: { organizationScope: 'org-abc' },
          expired: false,
          revoked: false,
        },
      ] as PluginPermissionGrantedRef[],
      idempotencyKey: 'idem-001',
    }
    const id1 = pdComputeDecisionId(base)
    const id2 = pdComputeDecisionId({
      ...base,
      requested: [{ permissionKey: 'write', scopeKind: 'project' }],
    })
    expect(id1).not.toBe(id2)
  })

  it('permutation invariance: same input in different order → same decision id', () => {
    const inputA = {
      schemaVersion: '1',
      organizationScope: 'org-abc',
      mode: 'plugin-runtime' as PluginPermissionDecisionMode,
      operation: 'execute' as PluginPermissionDecisionOperation,
      targetRef: 'target:123',
      requested: [
        { permissionKey: 'b.write', scopeKind: 'project' },
        { permissionKey: 'a.read', scopeKind: 'organization' },
      ] as PluginPermissionRequestedRef[],
      granted: [
        {
          grantId: 'g2',
          permissionKey: 'b.write',
          scopeBinding: { organizationScope: 'org' },
          expired: false,
          revoked: false,
        },
        {
          grantId: 'g1',
          permissionKey: 'a.read',
          scopeBinding: { organizationScope: 'org' },
          expired: false,
          revoked: false,
        },
      ] as PluginPermissionGrantedRef[],
      idempotencyKey: 'idem-001',
    }
    const inputB = {
      ...inputA,
      requested: [...inputA.requested].reverse(),
      granted: [...inputA.granted].reverse(),
    }
    expect(pdComputeDecisionId(inputA)).toBe(pdComputeDecisionId(inputB))
  })

  it('fingerprint is same as decision id (secret-free by design)', () => {
    const input = {
      schemaVersion: '1',
      organizationScope: 'org-abc',
      mode: 'plugin-runtime' as PluginPermissionDecisionMode,
      operation: 'execute' as PluginPermissionDecisionOperation,
      targetRef: 'target:123',
      requested: [
        { permissionKey: 'read', scopeKind: 'project' },
      ] as PluginPermissionRequestedRef[],
      granted: [
        {
          grantId: 'g1',
          permissionKey: 'read',
          scopeBinding: { organizationScope: 'org-abc' },
          expired: false,
          revoked: false,
        },
      ] as PluginPermissionGrantedRef[],
      idempotencyKey: 'idem-001',
    }
    expect(pdComputeInputFingerprint(input)).toBe(pdComputeDecisionId(input))
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.6: Reason priority ordering
// ═══════════════════════════════════════════════════════════════

describe('Task 2.6 — reason priority ordering', () => {
  it('authority-spoofing has highest priority (lowest number)', () => {
    const codes: PluginPermissionReasonCode[] = [
      'audit-unavailable',
      'rbac-denied',
      'authority-spoofing',
      'unknown-error',
    ]
    const sorted = pdDeriveReasonPriority(codes)
    expect(sorted[0]).toBe('authority-spoofing')
  })

  it('stable ordering: same input always produces same order', () => {
    const codes: PluginPermissionReasonCode[] = [
      'grant-escalation',
      'rbac-denied',
      'scope-mismatch',
      'tamper-detected',
    ]
    const s1 = pdDeriveReasonPriority(codes)
    const s2 = pdDeriveReasonPriority([...codes].reverse())
    expect(s1).toEqual(s2)
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.8: Low-sensitivity serialization tests
// ═══════════════════════════════════════════════════════════════

describe('Task 2.8 — low-sensitivity in fixtures', () => {
  const FORBIDDEN_PATTERNS = [
    /password/i,
    /secret/i,
    /token/i,
    /api_key/i,
    /api-key/i,
    /authorization/i,
    /bearer/i,
    /ghp_[a-zA-Z0-9]/,
    /sk-[a-zA-Z0-9]/,
    /:\/\/[^/]+/, // URLs
  ]

  function assertNoSensitiveContent(obj: unknown, path = 'root'): void {
    const serialized = JSON.stringify(obj)
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(pattern.test(serialized), `${path} contains sensitive pattern: ${pattern}`).toBe(false)
    }
  }

  for (const [id, record] of Object.entries(PLUGIN_PERMISSION_DECISION_FIXTURES)) {
    it(`fixture "${id}" contains no sensitive content`, () => {
      assertNoSensitiveContent(record, `fixture:${id}`)
    })
  }
})

// ═══════════════════════════════════════════════════════════════
// Task 2.12: Fixture index & coverage
// ═══════════════════════════════════════════════════════════════

describe('Task 2.12 — fixture index & coverage', () => {
  it('no duplicate fixture ids', () => {
    const ids = PLUGIN_PERMISSION_DECISION_FIXTURE_IDS
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('fixture collection matches id list', () => {
    const fixtureIds = Object.keys(PLUGIN_PERMISSION_DECISION_FIXTURES)
    expect(fixtureIds.sort()).toEqual([...PLUGIN_PERMISSION_DECISION_FIXTURE_IDS].sort())
  })

  it('all rule families have at least one fixture', () => {
    const coveredFamilies = new Set(Object.values(FIXTURE_TO_RULE_FAMILY))
    for (const family of PLUGIN_PERMISSION_DECISION_RULE_FAMILIES) {
      expect(coveredFamilies.has(family), `rule family "${family}" has no fixture`).toBe(true)
    }
  })

  it('every fixture has a rule family mapping', () => {
    for (const id of PLUGIN_PERMISSION_DECISION_FIXTURE_IDS) {
      expect(FIXTURE_TO_RULE_FAMILY[id], `fixture "${id}" has no rule family`).toBeDefined()
    }
  })

  it('fixture expected assertions match fixture count', () => {
    expect(FIXTURE_EXPECTED_ASSERTIONS.length).toBe(PLUGIN_PERMISSION_DECISION_FIXTURE_IDS.length)
  })

  it('expected assertions match fixture outcomes', () => {
    for (const assertion of FIXTURE_EXPECTED_ASSERTIONS) {
      const fixture = PLUGIN_PERMISSION_DECISION_FIXTURES[assertion.fixtureId]
      expect(fixture).toBeDefined()
      expect(fixture.outcome).toBe(assertion.expectedOutcome)
      expect(fixture.schemaVersion).toBe(assertion.expectedSchemaVersion)
    }
  })

  it('stable fixture ordering', () => {
    const ids1 = [...PLUGIN_PERMISSION_DECISION_FIXTURE_IDS]
    const ids2 = [...PLUGIN_PERMISSION_DECISION_FIXTURE_IDS]
    expect(ids1).toEqual(ids2)
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.10: Observation contract tests
// ═══════════════════════════════════════════════════════════════

describe('Task 2.10 — observation status type guards', () => {
  it('observation finding status guard', () => {
    expect(isPluginPermissionObservationFindingStatus('pass')).toBe(true)
    expect(isPluginPermissionObservationFindingStatus('fail')).toBe(true)
    expect(isPluginPermissionObservationFindingStatus('warn')).toBe(true)
    expect(isPluginPermissionObservationFindingStatus('skip')).toBe(true)
    expect(isPluginPermissionObservationFindingStatus('unknown')).toBe(false)
  })

  it('observation status guard', () => {
    expect(isPluginPermissionObservationStatus('healthy')).toBe(true)
    expect(isPluginPermissionObservationStatus('degraded')).toBe(true)
    expect(isPluginPermissionObservationStatus('unavailable')).toBe(true)
    expect(isPluginPermissionObservationStatus('unknown')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.13: Barrel import smoke (no runtime dependencies)
// ═══════════════════════════════════════════════════════════════

describe('Task 2.13 — barrel import smoke', () => {
  // 5s 默认超时对这一条不够：barrel 现在星号导出约 200 个模块，vitest 冷启动时
  // 光 transform + collect 这一棵图就压在 5s 边界上，测试于是随机红——它要证的是
  // 「能导入且关键导出在」，不是导入有多快，故显式放宽超时而不是削断言。
  it('can import from barrel index without error', async () => {
    const mod = await import('../src/index.js')
    // Verify key exports exist
    expect(mod.PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION).toBe('1')
    expect(mod.isPluginPermissionDecisionMode).toBeDefined()
    expect(mod.pdComputeDecisionId).toBeDefined()
    expect(mod.pdFnv1aHash).toBeDefined()
    expect(mod.FIXTURE_ALLOW_HAPPY_PATH).toBeDefined()
    expect(mod.PLUGIN_PERMISSION_DECISION_FIXTURES).toBeDefined()
  }, 60_000)

  it('exports do not include AdonisJS/React/DB/network/OTel runtime', async () => {
    const mod = await import('../src/index.js')
    const exportedKeys = Object.keys(mod)
    // These should not appear as export names
    const forbiddenImports = [
      'HttpContext',
      'Router',
      'Route', // AdonisJS
      'React',
      'useState',
      'useEffect', // React
      'knex',
      'LucidModel', // DB
      'fetch',
      'axios', // Network
      'trace',
      'span', // OTel
    ]
    for (const name of forbiddenImports) {
      expect(exportedKeys).not.toContain(name)
    }
  }, 60_000)
})

// ═══════════════════════════════════════════════════════════════
// Task 2.10: Observation degraded ≠ authorization third state
// ═══════════════════════════════════════════════════════════════

describe('Task 2.10 — observation degraded ≠ authorization', () => {
  it('FIXTURE_ALLOW_HAPPY_PATH has observationDegraded=false when allowed', () => {
    expect(FIXTURE_ALLOW_HAPPY_PATH.outcome).toBe('allowed')
    expect(FIXTURE_ALLOW_HAPPY_PATH.observationDegraded).toBe(false)
  })

  it('FIXTURE_DENY_RBAC is denied, not degraded', () => {
    expect(FIXTURE_DENY_RBAC.outcome).toBe('denied')
    expect(FIXTURE_DENY_RBAC.reasonCode).toBe('rbac-denied')
  })

  it('FIXTURE_DENY_AUDIT_FAILURE is denied, not degraded', () => {
    expect(FIXTURE_DENY_AUDIT_FAILURE.outcome).toBe('denied')
    expect(FIXTURE_DENY_AUDIT_FAILURE.reasonCode).toBe('audit-unavailable')
  })

  it('FIXTURE_SENSITIVE_REDACTED has allowed outcome with redacted refs', () => {
    expect(FIXTURE_SENSITIVE_REDACTED.outcome).toBe('allowed')
    expect(FIXTURE_SENSITIVE_REDACTED.actorRef).toContain('REDACTED')
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.10: Replay detection contract
// ═══════════════════════════════════════════════════════════════

describe('Task 2.10 — replay detection contract', () => {
  it('FIXTURE_DENY_REPLAY is denied with replay-detected reason', () => {
    expect(FIXTURE_DENY_REPLAY.outcome).toBe('denied')
    expect(FIXTURE_DENY_REPLAY.reasonCode).toBe('replay-detected')
  })

  it('FIXTURE_DENY_REPLAY has unique decision id', () => {
    expect(FIXTURE_DENY_REPLAY.decisionId).toBeTruthy()
    expect(FIXTURE_DENY_REPLAY.decisionId).not.toBe(FIXTURE_ALLOW_HAPPY_PATH.decisionId)
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.10: Cross-tenant denial contract
// ═══════════════════════════════════════════════════════════════

describe('Task 2.10 — cross-tenant denial', () => {
  it('FIXTURE_DENY_SCOPE_MISMATCH is denied with scope-mismatch reason', () => {
    expect(FIXTURE_DENY_SCOPE_MISMATCH.outcome).toBe('denied')
    expect(FIXTURE_DENY_SCOPE_MISMATCH.reasonCode).toBe('scope-mismatch')
  })
})

// ═══════════════════════════════════════════════════════════════
// Task 2.10: Grant escalation contract
// ═══════════════════════════════════════════════════════════════

describe('Task 2.10 — grant escalation', () => {
  it('FIXTURE_DENY_GRANT_ESCALATION is denied with grant-escalation reason', () => {
    expect(FIXTURE_DENY_GRANT_ESCALATION.outcome).toBe('denied')
    expect(FIXTURE_DENY_GRANT_ESCALATION.reasonCode).toBe('grant-escalation')
  })

  it('requested permission exceeds granted scope', () => {
    expect(FIXTURE_DENY_GRANT_ESCALATION.requestedPermissions[0].permissionKey).toBe(
      'project.tasks.write',
    )
    expect(FIXTURE_DENY_GRANT_ESCALATION.grantedPermissions[0].permissionKey).toBe(
      'project.tasks.read',
    )
  })
})
