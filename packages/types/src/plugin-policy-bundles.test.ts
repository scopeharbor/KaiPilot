/**
 * plugin-policy-bundles.test.ts — 任务 1.3 / 1.5
 * 覆盖：unknown permission/operation、表达式注入、敏感 metadata、冲突规则、
 * 稳定排序/digest、内置三模板 allow/deny 基线与「模板不得扩大 RBAC」。
 */

import { describe, it, expect } from 'vitest'
import {
  PLUGIN_POLICY_BUNDLE_SCHEMA_VERSION,
  BUILTIN_PLUGIN_POLICY_TEMPLATES,
  getBuiltinPluginPolicyTemplate,
  validatePluginPolicyBundleDocument,
  comparePluginPolicyCopyToBaseline,
  computePluginPolicyBundleDigest,
  normalizePluginPolicyBundleDocument,
  createVerifiedPluginPolicySnapshot,
  verifyPluginPolicySnapshot,
  evaluatePluginPolicy,
  type PluginPolicyBundleRule,
} from './plugin-policy-bundles.js'
import {
  POLICY_TEST_KNOWN_PERMISSIONS,
  ROLE_HOST_PLUGIN_PERMISSIONS,
  roleHoldsPluginPermission,
  makePolicyBundle,
  makePolicyRule,
  cloneBuiltinTemplateDocument,
} from './plugin-policy-bundles-fixtures.js'

const CTX = { knownPermissionKeys: POLICY_TEST_KNOWN_PERMISSIONS }

// =============================================================================
// 任务 1.3：封闭词表 / 注入 / 冲突 / 稳定 digest
// =============================================================================

describe('validatePluginPolicyBundleDocument — 封闭词表与 fail closed', () => {
  it('未知 permission（宿主已知集之外）→ blocking policy-unknown-permission', () => {
    const doc = makePolicyBundle({
      rules: [
        makePolicyRule({
          effect: 'allow',
          operation: undefined,
          permissionKey: 'acme.unknown.perm',
        }),
      ],
    })
    const res = validatePluginPolicyBundleDocument(doc, CTX)
    expect(res.valid).toBe(false)
    expect(
      res.findings.some((f) => f.code === 'policy-unknown-permission' && f.severity === 'blocking'),
    ).toBe(true)
  })

  it('未知 operation → blocking policy-unknown-operation', () => {
    const doc = makePolicyBundle({
      rules: [{ role: 'member', effect: 'deny', operation: 'install-plugin' as never }],
    })
    const res = validatePluginPolicyBundleDocument(doc, CTX)
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'policy-unknown-operation')).toBe(true)
  })

  it('未知 role / ceiling → blocking', () => {
    const doc = makePolicyBundle({
      rules: [
        makePolicyRule({ role: 'superuser' as never }),
        makePolicyRule({ operation: 'execute', scopeCeiling: 'global' as never }),
        makePolicyRule({ operation: 'ui-slot', sideEffectCeiling: 'arbitrary' as never }),
      ],
    })
    const res = validatePluginPolicyBundleDocument(doc, CTX)
    expect(res.valid).toBe(false)
    for (const code of ['policy-unknown-role', 'policy-unknown-ceiling']) {
      expect(res.findings.some((f) => f.code === code)).toBe(true)
    }
  })

  it('operation 与 permissionKey 同时缺省/同时存在 → schema-invalid', () => {
    const bothMissing = validatePluginPolicyBundleDocument(
      makePolicyBundle({ rules: [{ role: 'member', effect: 'deny' } as PluginPolicyBundleRule] }),
      CTX,
    )
    expect(bothMissing.valid).toBe(false)
    const bothPresent = validatePluginPolicyBundleDocument(
      makePolicyBundle({
        rules: [makePolicyRule({ operation: 'execute', permissionKey: 'plugin_install:manage' })],
      }),
      CTX,
    )
    expect(bothPresent.valid).toBe(false)
  })

  it('表达式注入形态（permissionKey / descriptionZh）→ blocking policy-expression-rejected', () => {
    const viaPerm = validatePluginPolicyBundleDocument(
      makePolicyBundle({
        rules: [
          makePolicyRule({
            operation: undefined,
            permissionKey: 'plugin_install:manage${process.env.X}',
          }),
        ],
      }),
      CTX,
    )
    expect(viaPerm.valid).toBe(false)
    expect(viaPerm.findings.some((f) => f.code === 'policy-expression-rejected')).toBe(true)

    const viaDesc = validatePluginPolicyBundleDocument(
      makePolicyBundle({ descriptionZh: '说明 function( evil ) 注入' }),
      CTX,
    )
    expect(viaDesc.valid).toBe(false)
    expect(viaDesc.findings.some((f) => f.code === 'policy-expression-rejected')).toBe(true)
  })

  it('敏感 metadata 键（token/apiKey 等）→ blocking policy-sensitive-metadata', () => {
    const res = validatePluginPolicyBundleDocument(
      makePolicyBundle({ apiKeyHint: 'sk-xxx' } as never),
      CTX,
    )
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'policy-sensitive-metadata')).toBe(true)
  })

  it('authority claim 键（organizationId 等）→ blocking policy-authority-claim', () => {
    const res = validatePluginPolicyBundleDocument(
      makePolicyBundle({ organizationId: 42 } as never),
      CTX,
    )
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'policy-authority-claim')).toBe(true)
  })

  it('同 (role,target) allow+deny 冲突 → blocking policy-conflicting-rule', () => {
    const res = validatePluginPolicyBundleDocument(
      makePolicyBundle({
        rules: [
          makePolicyRule({ role: 'project_manager', effect: 'allow', operation: 'execute' }),
          makePolicyRule({ role: 'project_manager', effect: 'deny', operation: 'execute' }),
        ],
      }),
      CTX,
    )
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'policy-conflicting-rule')).toBe(true)
  })

  it('完全重复规则 → warning 去重，valid 保持 true 且 digest 与手写去重版一致', () => {
    const rule = makePolicyRule({ role: 'member', effect: 'deny', operation: 'execute' })
    const withDup = validatePluginPolicyBundleDocument(
      makePolicyBundle({ rules: [rule, { ...rule }] }),
      CTX,
    )
    expect(withDup.valid).toBe(true)
    expect(
      withDup.findings.some((f) => f.code === 'policy-duplicate-rule' && f.severity === 'warning'),
    ).toBe(true)
    const deduped = validatePluginPolicyBundleDocument(makePolicyBundle({ rules: [rule] }), CTX)
    expect(withDup.digest).toBe(deduped.digest)
  })

  it('bundleId/version/description 非法 → 对应 blocking finding', () => {
    const badId = validatePluginPolicyBundleDocument(makePolicyBundle({ bundleId: 'Bad Id!' }), CTX)
    expect(badId.findings.some((f) => f.code === 'policy-bundle-id-invalid')).toBe(true)
    const badVersion = validatePluginPolicyBundleDocument(makePolicyBundle({ version: 0 }), CTX)
    expect(badVersion.findings.some((f) => f.code === 'policy-version-invalid')).toBe(true)
    const badDesc = validatePluginPolicyBundleDocument(makePolicyBundle({ descriptionZh: '' }), CTX)
    expect(badDesc.findings.some((f) => f.code === 'policy-description-invalid')).toBe(true)
    for (const r of [badId, badVersion, badDesc]) expect(r.valid).toBe(false)
  })
})

describe('稳定排序与确定性 digest', () => {
  it('规则乱序输入产生相同 normalized 顺序与相同 digest', () => {
    const a = makePolicyBundle({
      rules: [
        makePolicyRule({ role: 'org_admin', effect: 'allow', operation: 'ui-slot' }),
        makePolicyRule({ role: 'member', effect: 'deny', operation: 'execute' }),
        makePolicyRule({
          role: 'member',
          effect: 'allow',
          operation: undefined,
          permissionKey: 'plugin_install:view',
        }),
      ],
    })
    const b = makePolicyBundle({
      bundleId: a.bundleId,
      descriptionZh: a.descriptionZh,
      version: a.version,
      rules: [...a.rules].reverse(),
    })
    const ra = validatePluginPolicyBundleDocument(a, CTX)
    const rb = validatePluginPolicyBundleDocument(b, CTX)
    expect(ra.valid).toBe(true)
    expect(rb.valid).toBe(true)
    expect(ra.normalized?.rules.map((r) => r.operation ?? r.permissionKey)).toEqual(
      rb.normalized?.rules.map((r) => r.operation ?? r.permissionKey),
    )
    expect(ra.digest).toBe(rb.digest)
  })

  it('任一规则变化 → digest 变化；digest 域分隔且稳定可复算', () => {
    const base = normalizePluginPolicyBundleDocument(makePolicyBundle())
    const d1 = computePluginPolicyBundleDigest(base)
    const d2 = computePluginPolicyBundleDigest(base)
    expect(d1).toBe(d2)
    const changed = normalizePluginPolicyBundleDocument(
      makePolicyBundle({
        version: 2,
        rules: [makePolicyRule({ role: 'member', effect: 'deny', operation: 'ui-slot' })],
      }),
    )
    expect(computePluginPolicyBundleDigest(changed)).not.toBe(d1)
  })
})

// =============================================================================
// 任务 1.4/1.5：内置模板基线 + 模板不得扩大 RBAC
// =============================================================================

describe('内置模板（admin-managed / pm-enabled / member-readonly）', () => {
  it('三个模板齐全、中文说明非空、文档全部通过宿主已知集校验', () => {
    expect(BUILTIN_PLUGIN_POLICY_TEMPLATES.map((t) => t.templateId)).toEqual([
      'admin-managed',
      'pm-enabled',
      'member-readonly',
    ])
    for (const t of BUILTIN_PLUGIN_POLICY_TEMPLATES) {
      expect(t.titleZh.length).toBeGreaterThan(0)
      expect(t.document.descriptionZh.length).toBeGreaterThan(0)
      expect(t.document.schemaVersion).toBe(PLUGIN_POLICY_BUNDLE_SCHEMA_VERSION)
      const res = validatePluginPolicyBundleDocument(t.document, CTX)
      expect(res.valid).toBe(true)
    }
    expect(getBuiltinPluginPolicyTemplate('admin-managed')).toBeDefined()
    expect(getBuiltinPluginPolicyTemplate('no-such-template')).toBeUndefined()
  })

  it('每个模板的 allow permission 规则都不超出该角色的 RBAC 插件权限基线', () => {
    for (const t of BUILTIN_PLUGIN_POLICY_TEMPLATES) {
      for (const rule of t.document.rules) {
        if (rule.effect === 'allow' && rule.permissionKey != null) {
          expect(
            roleHoldsPluginPermission(rule.role, rule.permissionKey),
            `${t.templateId}: ${rule.role} 不持有 ${rule.permissionKey} 却被 allow`,
          ).toBe(true)
        }
      }
    }
  })

  it('角色基线矩阵：admin 全量可用；pm 按 posture；member 一律只读且显式拒绝管理面', () => {
    const effectsFor = (
      templateId: string,
      role: string,
      target: { operation?: string; permissionKey?: string },
    ) => {
      const t = getBuiltinPluginPolicyTemplate(templateId)!
      return t.document.rules.filter(
        (r) =>
          r.role === role &&
          ((target.operation != null && r.operation === target.operation) ||
            (target.permissionKey != null && r.permissionKey === target.permissionKey)),
      )
    }
    for (const t of BUILTIN_PLUGIN_POLICY_TEMPLATES) {
      // 管理面：仅管理员 allow，低角色显式 deny
      for (const perm of ['plugin_install:manage', 'plugin_registry:manage']) {
        expect(
          effectsFor(t.templateId, 'system_admin', { permissionKey: perm }).some(
            (r) => r.effect === 'allow',
          ),
        ).toBe(true)
        expect(
          effectsFor(t.templateId, 'org_admin', { permissionKey: perm }).some(
            (r) => r.effect === 'allow',
          ),
        ).toBe(true)
        expect(
          effectsFor(t.templateId, 'project_manager', { permissionKey: perm }).some(
            (r) => r.effect === 'deny',
          ),
        ).toBe(true)
        expect(
          effectsFor(t.templateId, 'member', { permissionKey: perm }).some(
            (r) => r.effect === 'deny',
          ),
        ).toBe(true)
      }
      // 成员：只读 allow + 正式写无 allow（默认拒绝语义）
      expect(
        effectsFor(t.templateId, 'member', { operation: 'resolve-query' }).some(
          (r) => r.effect === 'allow',
        ),
      ).toBe(true)
      expect(
        effectsFor(t.templateId, 'member', { operation: 'execute' }).filter(
          (r) => r.effect === 'allow',
        ),
      ).toHaveLength(0)
    }
    // admin-managed：PM 无正式写 allow；pm-enabled/member-readonly：PM 六操作全 allow
    expect(
      effectsFor('admin-managed', 'project_manager', { operation: 'execute' }).filter(
        (r) => r.effect === 'allow',
      ),
    ).toHaveLength(0)
    for (const id of ['pm-enabled', 'member-readonly']) {
      for (const op of [
        'resolve-query',
        'execute',
        'command-proposal',
        'ui-slot',
        'skill-adapter',
        'compiler-contribution',
      ]) {
        expect(
          effectsFor(id, 'project_manager', { operation: op }).some((r) => r.effect === 'allow'),
        ).toBe(true)
      }
    }
  })

  it('组织副本只能收紧：deny 替换 allow / 新增 deny 合法；放宽 allow → blocking expansion', () => {
    const baseline = cloneBuiltinTemplateDocument('pm-enabled')
    // 合法收紧①：成员 ui-slot 的 allow 换成 deny；②：新增 baseline 未声明的 member deny execute
    const tightened = cloneBuiltinTemplateDocument('pm-enabled')
    tightened.version = 2
    tightened.bundleId = 'org-copy.pm-enabled'
    tightened.sourceTemplateId = 'pm-enabled'
    tightened.sourceTemplateVersion = 1
    tightened.rules = tightened.rules.map((r) =>
      r.role === 'member' && r.operation === 'ui-slot' ? { ...r, effect: 'deny' as const } : r,
    )
    tightened.rules.push(makePolicyRule({ role: 'member', effect: 'deny', operation: 'execute' }))
    const tightenRes = validatePluginPolicyBundleDocument(tightened, {
      ...CTX,
      baselineDocument: baseline,
    })
    expect(tightenRes.valid).toBe(true)

    // 放宽①：把 PM 的 manage deny 翻成 allow
    const loosenedAllow = cloneBuiltinTemplateDocument('pm-enabled')
    loosenedAllow.rules = loosenedAllow.rules.map((r) =>
      r.role === 'project_manager' && r.permissionKey === 'plugin_install:manage'
        ? { ...r, effect: 'allow' as const }
        : r,
    )
    const loosenRes1 = validatePluginPolicyBundleDocument(loosenedAllow, {
      ...CTX,
      baselineDocument: baseline,
    })
    expect(loosenRes1.valid).toBe(false)
    expect(loosenRes1.findings.some((f) => f.code === 'policy-template-expansion')).toBe(true)

    // 放宽②：删除成员的 manage deny 并新增 baseline 没有的 allow 目标
    const addedAllow = cloneBuiltinTemplateDocument('pm-enabled')
    addedAllow.rules = addedAllow.rules.filter(
      (r) => !(r.role === 'member' && r.permissionKey === 'plugin_install:manage'),
    )
    addedAllow.rules.push(
      makePolicyRule({
        role: 'member',
        effect: 'allow',
        operation: undefined,
        permissionKey: 'plugin_registry:view',
      }),
    )
    const loosenRes2 = validatePluginPolicyBundleDocument(addedAllow, {
      ...CTX,
      baselineDocument: baseline,
    })
    expect(loosenRes2.valid).toBe(false)
    expect(loosenRes2.findings.some((f) => f.code === 'policy-template-expansion')).toBe(true)

    // 纯比较函数直接断言
    expect(
      comparePluginPolicyCopyToBaseline(
        normalizePluginPolicyBundleDocument(addedAllow),
        normalizePluginPolicyBundleDocument(baseline),
      ).length,
    ).toBeGreaterThan(0)
  })
})

// =============================================================================
// 任务 2.1/2.2：deny-first 交集求值
// =============================================================================

describe('evaluatePluginPolicy — deny-first 交集', () => {
  const memberReadonlyDoc = validatePluginPolicyBundleDocument(
    cloneBuiltinTemplateDocument('member-readonly'),
    CTX,
  )
  expect(memberReadonlyDoc.valid).toBe(true)
  const snapshot = createVerifiedPluginPolicySnapshot({
    document: memberReadonlyDoc.normalized!,
    revision: 1,
    activatedAt: '2026-08-24T00:00:00.000Z',
    organizationScope: 'org:1',
  })
  const evalBase = {
    snapshot,
    actorRoles: ['member'] as const,
    scopeKind: 'project' as const,
    rbacAllowed: true,
  }

  it('显式 deny 优先于角色 allow（组织拒绝一票否决）', () => {
    // member-readonly 中成员对 plugin_install:manage 是显式 deny，即使 RBAC 放行也拒绝
    const res = evaluatePluginPolicy({
      ...evalBase,
      target: { permissionKey: 'plugin_install:manage' },
    })
    expect(res.allowed).toBe(false)
    expect(res.reasonCode).toBe('policy-deny')

    // 组织副本把成员 resolve-query 收紧为 deny → 覆盖模板 allow
    const orgCopy = cloneBuiltinTemplateDocument('member-readonly')
    orgCopy.rules = orgCopy.rules.map((r) =>
      r.role === 'member' && r.operation === 'resolve-query'
        ? { ...r, effect: 'deny' as const }
        : r,
    )
    const copyRes = validatePluginPolicyBundleDocument(orgCopy, CTX)
    const copySnap = createVerifiedPluginPolicySnapshot({
      document: copyRes.normalized!,
      revision: 2,
      activatedAt: '2026-08-24T01:00:00.000Z',
      organizationScope: 'org:1',
    })
    const denied = evaluatePluginPolicy({
      ...evalBase,
      snapshot: copySnap,
      target: { operation: 'resolve-query' },
    })
    expect(denied.reasonCode).toBe('policy-deny')
  })

  it('未知 operation/permission 与红线命中均 fail closed', () => {
    const badOp = evaluatePluginPolicy({
      ...evalBase,
      target: { operation: 'deploy-prod' as never },
    })
    expect(badOp.reasonCode).toBe('policy-unknown-operation')
    const badPerm = evaluatePluginPolicy({
      ...evalBase,
      target: { permissionKey: '' },
    })
    expect(badPerm.reasonCode).toBe('policy-unknown-permission')
    const redline = evaluatePluginPolicy({
      ...evalBase,
      target: { operation: 'resolve-query' },
      redlineHit: true,
    })
    expect(redline.reasonCode).toBe('policy-redline')
  })

  it('策略绝不放大 RBAC：rbacAllowed=false 时即便角色 allow 也拒绝', () => {
    const pm = evaluatePluginPolicy({
      ...evalBase,
      actorRoles: ['project_manager'],
      target: { operation: 'execute' },
      sideEffect: 'formal-write',
      rbacAllowed: false,
    })
    expect(pm.allowed).toBe(false)
    expect(pm.reasonCode).toBe('policy-rbac-denied')
  })

  it('成员正式写默认拒绝、查询类放行；PM 正式写有 allow 且上限内放行', () => {
    const memberWrite = evaluatePluginPolicy({
      ...evalBase,
      target: { operation: 'execute' },
      sideEffect: 'formal-write',
    })
    expect(memberWrite.allowed).toBe(false)
    expect(memberWrite.reasonCode).toBe('policy-write-requires-allow')
    const memberRead = evaluatePluginPolicy({
      ...evalBase,
      target: { operation: 'resolve-query' },
      sideEffect: 'read-only',
    })
    expect(memberRead.allowed).toBe(true)
    const pmWrite = evaluatePluginPolicy({
      ...evalBase,
      actorRoles: ['project_manager'],
      target: { operation: 'execute' },
      sideEffect: 'formal-write',
    })
    expect(pmWrite.allowed).toBe(true)
    // PM 上限为 project scope：请求 organization scope 超出
    const pmOrgScope = evaluatePluginPolicy({
      ...evalBase,
      actorRoles: ['project_manager'],
      target: { operation: 'execute' },
      sideEffect: 'formal-write',
      scopeKind: 'organization',
    })
    expect(pmOrgScope.reasonCode).toBe('policy-ceiling-exceeded')
  })

  it('相同输入产生相同结果与 policyDigest；digest 随快照版本变化', () => {
    const input = {
      ...evalBase,
      target: { operation: 'ui-slot' as const },
      sideEffect: 'read-only' as const,
    }
    const a = evaluatePluginPolicy(input)
    const b = evaluatePluginPolicy(input)
    expect(a).toEqual(b)
    expect(a.policyDigest).toBe(snapshot.digest)
    const v2 = createVerifiedPluginPolicySnapshot({
      document: memberReadonlyDoc.normalized!,
      revision: 9,
      activatedAt: '2026-08-25T00:00:00.000Z',
      organizationScope: 'org:1',
    })
    // 同文档不同 revision：digest 不变（内容寻址），revision 变化
    const v2Result = evaluatePluginPolicy({ ...input, snapshot: v2 })
    expect(v2Result.policyDigest).toBe(a.policyDigest)
    expect(v2Result.revision).toBe(9)
    // 文档内容变化 → digest 变化
    const changedDoc = cloneBuiltinTemplateDocument('member-readonly')
    changedDoc.rules = changedDoc.rules.map((r) =>
      r.role === 'member' && r.operation === 'ui-slot' ? { ...r, effect: 'deny' as const } : r,
    )
    const changedSnap = createVerifiedPluginPolicySnapshot({
      document: validatePluginPolicyBundleDocument(changedDoc, CTX).normalized!,
      revision: 10,
      activatedAt: '2026-08-25T00:00:00.000Z',
      organizationScope: 'org:1',
    })
    expect(evaluatePluginPolicy({ ...input, snapshot: changedSnap }).policyDigest).not.toBe(
      a.policyDigest,
    )
  })

  it('性能门禁：1000 次求值确定性且在预算内完成', () => {
    const inputs = Array.from({ length: 1000 }, (_, i) => ({
      ...evalBase,
      actorRoles: (i % 2 === 0 ? ['member'] : ['project_manager']) as (
        'member' | 'project_manager'
      )[],
      target:
        i % 3 === 0
          ? ({ operation: 'execute' } as const)
          : ({ operation: 'resolve-query' } as const),
      sideEffect: i % 3 === 0 ? ('formal-write' as const) : ('read-only' as const),
    }))
    const start = performance.now()
    const runA = inputs.map((i) => evaluatePluginPolicy(i))
    const elapsed = performance.now() - start
    const runB = inputs.map((i) => evaluatePluginPolicy(i))
    expect(runA).toEqual(runB)
    expect(runA.length).toBe(1000)
    expect(elapsed).toBeLessThan(2000)
  })
})

describe('verified snapshot 构造与验证', () => {
  it('合法快照通过验证；损坏/版本未知/组织不匹配分别给出稳定 reason code', () => {
    const docRes = validatePluginPolicyBundleDocument(
      cloneBuiltinTemplateDocument('member-readonly'),
      CTX,
    )
    expect(docRes.valid && docRes.normalized && docRes.digest).toBeTruthy()
    const snapshot = createVerifiedPluginPolicySnapshot({
      document: docRes.normalized!,
      revision: 3,
      activatedAt: new Date('2026-08-24T00:00:00.000Z').toISOString(),
      organizationScope: 'org:7',
    })
    expect(verifyPluginPolicySnapshot(snapshot, { organizationScope: 'org:7' }).valid).toBe(true)

    const corrupted = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
    corrupted.document.rules = corrupted.document.rules.slice(0, -1)
    expect(verifyPluginPolicySnapshot(corrupted)).toEqual({
      valid: false,
      reasonCode: 'policy-snapshot-invalid',
    })

    const badVersion = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot
    ;(badVersion.document as { schemaVersion: string }).schemaVersion = '9.9'
    expect(verifyPluginPolicySnapshot(badVersion)).toEqual({
      valid: false,
      reasonCode: 'policy-snapshot-version-unknown',
    })

    expect(verifyPluginPolicySnapshot(snapshot, { organizationScope: 'org:8' })).toEqual({
      valid: false,
      reasonCode: 'policy-snapshot-org-mismatch',
    })
    expect(verifyPluginPolicySnapshot(null)).toEqual({
      valid: false,
      reasonCode: 'policy-snapshot-invalid',
    })
  })

  it('ROLE_HOST_PLUGIN_PERMISSIONS 基线自洽：管理类权限只归管理员', () => {
    for (const role of [
      'project_manager',
      'member',
      'external_collaborator',
      'readonly_observer',
    ] as const) {
      for (const perm of ['plugin_install:manage', 'plugin_registry:manage']) {
        expect(roleHoldsPluginPermission(role, perm)).toBe(false)
        void ROLE_HOST_PLUGIN_PERMISSIONS[role]
      }
    }
  })
})
