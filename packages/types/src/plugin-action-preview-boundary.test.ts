import { describe, expect, it } from 'vitest'
import {
  assembleActionBulkResults,
  assertActionDryRunGate,
  buildPluginActionConfirmHandle,
  computeActionHandleDigest,
  computeProposalDigest,
  computePreviewDigest,
  containsActionSensitiveValue,
  deriveActionIdempotencyKey,
  findForbiddenAdapterProperties,
  isActionSensitiveKey,
  isActionPreviewConfirmable,
  isExplicitUserConfirm,
  isPluginActionReasonCode,
  revalidateActionSourceRefs,
  sanitizeActionEnvelope,
  scanActionEnvelopeForSensitiveResidue,
  translateActionDecision,
  validateActionHandleBinding,
  validateAdapterDescriptor,
  validatePluginActionProposal,
} from './plugin-action-preview-boundary.js'
import {
  fixtureCrossOrgHandle,
  fixtureForbiddenAdapterDescriptor,
  fixtureOversizedProposal,
  fixturePilotConfirmHandle,
  fixturePilotPreviewWithDigest,
  fixturePilotProposal,
  fixturePilotSourceRef,
  fixtureExtraTopLevelFieldProposal,
  fixturePluginOwnedAdapterDescriptor,
  fixtureSensitiveMaterialProposal,
  fixtureUnknownInputFieldProposal,
  fixtureUnknownKindProposal,
  ACTION_FIXTURE_NOW_ISO,
} from './plugin-action-preview-boundary-fixtures.js'

describe('plugin-action-preview-boundary canonical digest', () => {
  it('digest 与键序无关且跨调用稳定', () => {
    const a = fixturePilotProposal()
    const reordered = {
      sourceRefs: a.sourceRefs,
      inputPayload: { content: a.inputPayload.content, title: a.inputPayload.title },
      scope: { projectId: null, organizationId: 1 },
      actionKind: a.actionKind,
      schemaVersion: a.schemaVersion,
    } as const
    expect(computeProposalDigest(a)).toBe(computeProposalDigest(reordered))
    expect(computeProposalDigest(a)).toBe(computeProposalDigest(fixturePilotProposal()))
  })

  it('payload 变化改变 digest；createdAt 不参与 digest', () => {
    const base = fixturePilotProposal()
    const changed = fixturePilotProposal({
      inputPayload: { title: '另一个标题', content: '不同内容' },
    })
    expect(computeProposalDigest(base)).not.toBe(computeProposalDigest(changed))

    const withOtherCreatedAt = { ...base, createdAt: '2030-01-01T00:00:00.000Z' }
    expect(computeProposalDigest(base)).toBe(computeProposalDigest(withOtherCreatedAt))
  })

  it('preview digest 覆盖审查字段并区分 dry-run 结论变化', () => {
    const good = fixturePilotPreviewWithDigest()
    const blockedBase = { ...good, previewDigest: undefined } as unknown as Omit<
      typeof good,
      'previewDigest'
    >
    const blocked = {
      ...blockedBase,
      dryRun: {
        canApply: false,
        findings: [{ code: 'dep-cycle', severity: 'blocking' as const, message: '依赖环' }],
      },
    }
    expect(good.previewDigest).not.toBe(computePreviewDigest(blocked))
    // 相同内容重算一致
    const rebuilt = fixturePilotPreviewWithDigest()
    expect(rebuilt.previewDigest).toBe(good.previewDigest)
  })
})

describe('plugin-action-preview-boundary proposal validation（unknown action/payload）', () => {
  it('合法提案通过', () => {
    const res = validatePluginActionProposal(fixturePilotProposal())
    expect(res.valid).toBe(true)
    expect(res.findings).toHaveLength(0)
  })

  it('拒绝未知 action kind', () => {
    const res = validatePluginActionProposal(fixtureUnknownKindProposal())
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'action-kind-unknown')).toBe(true)
  })

  it('拒绝未知顶层字段（直写通道企图）', () => {
    const res = validatePluginActionProposal(fixtureExtraTopLevelFieldProposal())
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.path === 'repositoryWrite')).toBe(true)
  })

  it('拒绝输入载荷未知字段（含 SQL 企图）', () => {
    const res = validatePluginActionProposal(fixtureUnknownInputFieldProposal())
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.path === 'inputPayload.sqlStatement')).toBe(true)
  })

  it('拒绝超限载荷', () => {
    const res = validatePluginActionProposal(fixtureOversizedProposal())
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'action-payload-too-large')).toBe(true)
  })
})

describe('plugin-action-preview-boundary sensitive material & sanitizer', () => {
  it('检测敏感键与敏感值', () => {
    expect(isActionSensitiveKey('apiKey')).toBe(true)
    expect(isActionSensitiveKey('Authorization')).toBe(true)
    expect(isActionSensitiveKey('title')).toBe(false)
    expect(containsActionSensitiveValue('bearer Bearer abc.def.ghi')).toBe(true)
    expect(containsActionSensitiveValue('普通中文内容')).toBe(false)
  })

  it('含敏感材料的提案被拒绝且给出稳定 reason code', () => {
    const res = validatePluginActionProposal(fixtureSensitiveMaterialProposal())
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'action-sensitive-material')).toBe(true)
  })

  it('sanitizer 剔除敏感键、替换敏感值，二次扫描零残留', () => {
    const dirty = {
      proposalId: 'p1',
      apiKey: 'sk-abcdefghijklmnopqrstuvwxyz012345',
      note: 'Bearer abcdef123456',
      nested: { toolArgs: 'should be dropped', keep: 'ok' },
      items: ['plain', 'sk-abcdefghijklmnopqrstuvwxyz012345'],
    }
    const clean = sanitizeActionEnvelope(dirty)
    expect(clean).not.toHaveProperty('apiKey')
    expect(clean.note).toBe('[REDACTED]')
    expect((clean.nested as Record<string, unknown>).toolArgs).toBeUndefined()
    expect((clean.nested as Record<string, unknown>).keep).toBe('ok')
    expect(clean.items[0]).toBe('plain')
    expect(clean.items[1]).toBe('[REDACTED]')
    expect(scanActionEnvelopeForSensitiveResidue(clean)).toHaveLength(0)
  })
})

describe('plugin-action-preview-boundary confirmation handle binding', () => {
  it('签发句柄 digest 前缀绑定且全匹配时校验通过', () => {
    const handle = fixturePilotConfirmHandle()
    expect(
      handle.handle.startsWith(`pact-cfm-${computeActionHandleDigest(handle).slice(0, 12)}`),
    ).toBe(true)

    const res = validateActionHandleBinding(handle, {
      proposalId: handle.proposalId,
      previewDigest: handle.previewDigest,
      actorUserId: handle.actorUserId,
      organizationId: handle.organizationId,
      projectId: handle.projectId,
      pluginId: handle.pluginId,
      pluginVersion: handle.pluginVersion,
      targetRevision: handle.targetRevision,
      idempotencyKey: handle.idempotencyKey,
      nowIso: ACTION_FIXTURE_NOW_ISO,
    })
    expect(res.valid).toBe(true)
  })

  it('跨组织/跨项目 scope 重放被拒为 cross-scope-denied', () => {
    const orgHandle = fixturePilotConfirmHandle({ scope: { organizationId: 7, projectId: null } })
    const resOrg = validateActionHandleBinding(orgHandle, {
      proposalId: orgHandle.proposalId,
      previewDigest: orgHandle.previewDigest,
      actorUserId: orgHandle.actorUserId,
      organizationId: 1,
      projectId: null,
      pluginId: orgHandle.pluginId,
      pluginVersion: orgHandle.pluginVersion,
      targetRevision: orgHandle.targetRevision,
      idempotencyKey: orgHandle.idempotencyKey,
      nowIso: ACTION_FIXTURE_NOW_ISO,
    })
    expect(resOrg.valid).toBe(false)
    if (!resOrg.valid) expect(resOrg.error).toBe('cross-scope-denied')

    const projHandle = fixturePilotConfirmHandle({ scope: { organizationId: 1, projectId: 5 } })
    const resProj = validateActionHandleBinding(projHandle, {
      proposalId: projHandle.proposalId,
      previewDigest: projHandle.previewDigest,
      actorUserId: projHandle.actorUserId,
      organizationId: 1,
      projectId: 6,
      pluginId: projHandle.pluginId,
      pluginVersion: projHandle.pluginVersion,
      targetRevision: projHandle.targetRevision,
      idempotencyKey: projHandle.idempotencyKey,
      nowIso: ACTION_FIXTURE_NOW_ISO,
    })
    expect(resProj.valid).toBe(false)
    if (!resProj.valid) expect(resProj.error).toBe('cross-scope-denied')
  })

  it('actor 不匹配 → permission-denied；过期 → handle-expired', () => {
    const handle = fixturePilotConfirmHandle()
    const base = {
      proposalId: handle.proposalId,
      previewDigest: handle.previewDigest,
      actorUserId: handle.actorUserId,
      organizationId: handle.organizationId,
      projectId: handle.projectId,
      pluginId: handle.pluginId,
      pluginVersion: handle.pluginVersion,
      targetRevision: handle.targetRevision,
      idempotencyKey: handle.idempotencyKey,
      nowIso: ACTION_FIXTURE_NOW_ISO,
    }
    const resActor = validateActionHandleBinding(handle, { ...base, actorUserId: 999 })
    expect(resActor.valid).toBe(false)
    if (!resActor.valid) expect(resActor.error).toBe('permission-denied')

    const resExpired = validateActionHandleBinding(handle, {
      ...base,
      nowIso: '2026-08-24T18:00:00.000Z',
    })
    expect(resExpired.valid).toBe(false)
    if (!resExpired.valid) expect(resExpired.error).toBe('handle-expired')
  })

  it('preview digest / target revision / 插件版本 任一变化 → stale/mismatch（不静默刷新）', () => {
    const handle = fixturePilotConfirmHandle()
    const base = {
      proposalId: handle.proposalId,
      actorUserId: handle.actorUserId,
      organizationId: handle.organizationId,
      projectId: handle.projectId,
      pluginId: handle.pluginId,
      pluginVersion: handle.pluginVersion,
      idempotencyKey: handle.idempotencyKey,
      nowIso: ACTION_FIXTURE_NOW_ISO,
    }
    const resStale = validateActionHandleBinding(handle, {
      ...base,
      previewDigest: 'deadbeef',
      targetRevision: handle.targetRevision,
    })
    expect(resStale.valid).toBe(false)
    if (!resStale.valid) expect(resStale.error).toBe('preview-stale')

    const resRevision = validateActionHandleBinding(handle, {
      ...base,
      previewDigest: handle.previewDigest,
      targetRevision: 'pilot-items@rev-8',
    })
    expect(resRevision.valid).toBe(false)
    if (!resRevision.valid) expect(['preview-stale', 'handle-invalid']).toContain(resRevision.error)

    const resVersion = validateActionHandleBinding(handle, {
      ...base,
      previewDigest: handle.previewDigest,
      targetRevision: handle.targetRevision,
      pluginVersion: '2.0.0',
    })
    expect(resVersion.valid).toBe(false)
    if (!resVersion.valid) expect(resVersion.error).toBe('plugin-version-mismatch')
  })

  it('篡改绑定字段导致结构 digest 失配 → handle-invalid', () => {
    const handle = fixturePilotConfirmHandle()
    const tampered = { ...handle, proposalId: 'pact-proposal-other' }
    const res = validateActionHandleBinding(tampered, {
      proposalId: 'pact-proposal-fixture-001',
      previewDigest: handle.previewDigest,
      actorUserId: handle.actorUserId,
      organizationId: handle.organizationId,
      projectId: handle.projectId,
      pluginId: handle.pluginId,
      pluginVersion: handle.pluginVersion,
      targetRevision: handle.targetRevision,
      idempotencyKey: handle.idempotencyKey,
      nowIso: ACTION_FIXTURE_NOW_ISO,
    })
    // proposal mismatch 先命中
    expect(res.valid).toBe(false)
    if (!res.valid) expect(res.error).toBe('handle-invalid')

    // 直接构造 digest 与值不符的句柄
    const forged = { ...fixturePilotConfirmHandle(), handle: 'pact-cfm-000000000000' }
    const resForged = validateActionHandleBinding(forged, {
      proposalId: forged.proposalId,
      previewDigest: forged.previewDigest,
      actorUserId: forged.actorUserId,
      organizationId: forged.organizationId,
      projectId: forged.projectId,
      pluginId: forged.pluginId,
      pluginVersion: forged.pluginVersion,
      targetRevision: forged.targetRevision,
      idempotencyKey: forged.idempotencyKey,
      nowIso: ACTION_FIXTURE_NOW_ISO,
    })
    expect(resForged.valid).toBe(false)
    if (!resForged.valid) expect(resForged.error).toBe('handle-invalid')
  })

  it('跨组织 fixture 与正常句柄 digest 不同', () => {
    expect(fixtureCrossOrgHandle().organizationId).toBe(999)
    expect(computeActionHandleDigest(fixtureCrossOrgHandle())).not.toBe(
      computeActionHandleDigest(fixturePilotConfirmHandle()),
    )
  })

  it('buildPluginActionConfirmHandle 尊重自定义 TTL', () => {
    const h = buildPluginActionConfirmHandle({
      proposalId: 'p',
      previewDigest: 'd',
      actorUserId: 1,
      organizationId: 1,
      projectId: null,
      pluginId: 'x',
      pluginVersion: '1.0.0',
      targetRevision: 'r',
      idempotencyKey: 'k',
      nowIso: ACTION_FIXTURE_NOW_ISO,
      ttlSeconds: 30,
    })
    expect(new Date(h.expiresAt).getTime() - new Date(ACTION_FIXTURE_NOW_ISO).getTime()).toBe(
      30_000,
    )
  })
})

describe('plugin-action-preview-boundary adapter descriptor registry rules', () => {
  it('host-core 合法描述符通过', () => {
    const res = validateAdapterDescriptor({
      actionKind: 'plugin.pilot.item.create',
      owner: 'host-core',
      batchPolicy: 'per-item',
      reversibility: 'reversible',
      requiredPermissions: ['plugin_action:confirm'],
    })
    expect(res.valid).toBe(true)
  })

  it('拒绝插件自带 adapter（owner 非 host-core）', () => {
    const res = validateAdapterDescriptor(fixturePluginOwnedAdapterDescriptor())
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'adapter-not-host-owned')).toBe(true)
  })

  it('拒绝包含 repository/sql/url 直写声明的描述符', () => {
    const res = validateAdapterDescriptor(fixtureForbiddenAdapterDescriptor())
    expect(res.valid).toBe(false)
    expect(
      findForbiddenAdapterProperties(fixtureForbiddenAdapterDescriptor()).length,
    ).toBeGreaterThan(0)
  })

  it('拒绝未知 kind 的描述符', () => {
    const res = validateAdapterDescriptor({
      actionKind: 'domain.tasks.bulk-delete',
      owner: 'host-core',
      batchPolicy: 'per-item',
      reversibility: 'reversible',
      requiredPermissions: [],
    })
    expect(res.valid).toBe(false)
    expect(res.findings.some((f) => f.code === 'action-kind-unknown')).toBe(true)
  })
})

describe('plugin-action-preview-boundary decision semantics', () => {
  it('accept：有写入意图且不要求重新预览', () => {
    const t = translateActionDecision({ decision: 'accept' })
    expect(t.ok).toBe(true)
    if (t.ok) {
      expect(t.writeIntent).toBe(true)
      expect(t.requiresRePreview).toBe(false)
    }
  })

  it('modify 必须携带修改值且强制重新预览（旧 preview digest 失效）', () => {
    const missing = translateActionDecision({ decision: 'modify' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reasonCode).toBe('action-proposal-invalid')

    const ok = translateActionDecision({
      decision: 'modify',
      userModifiedValue: { title: '新标题' },
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.writeIntent).toBe(true)
      expect(ok.requiresRePreview).toBe(true)
    }
  })

  it('reject/discard 无写入意图（正式数据不变）', () => {
    for (const decision of ['reject', 'discard'] as const) {
      const t = translateActionDecision({ decision })
      expect(t.ok).toBe(true)
      if (t.ok) expect(t.writeIntent).toBe(false)
    }
  })

  it('唯一合法确认来源是显式用户确认（审批/高置信度不得自动转确认）', () => {
    expect(isExplicitUserConfirm('explicit-user-confirm')).toBe(true)
    expect(isExplicitUserConfirm('approval-granted')).toBe(false)
    expect(isExplicitUserConfirm('high-confidence-auto')).toBe(false)
  })
})

describe('plugin-action-preview-boundary batch per-item results', () => {
  it('逐项独立结果；fullyApplied 由逐项结局推导；失败不被洗白', () => {
    const mixed = assembleActionBulkResults([
      { itemRef: 'item-1', outcome: 'applied', reasonCode: null, message: '已写入' },
      {
        itemRef: 'item-2',
        outcome: 'stale_blocked',
        reasonCode: 'preview-stale',
        message: '来源已变化',
      },
      {
        itemRef: 'item-3',
        outcome: 'denied',
        reasonCode: 'permission-denied',
        message: '没有执行该操作的权限',
      },
    ])
    expect(mixed.fullyApplied).toBe(false)
    expect(mixed.results[0].outcome).toBe('applied')
    expect(mixed.results[1].outcome).toBe('stale_blocked')
    expect(mixed.results[2].outcome).toBe('denied')

    const allApplied = assembleActionBulkResults([
      { itemRef: 'a', outcome: 'applied', reasonCode: null, message: 'ok' },
      { itemRef: 'b', outcome: 'applied', reasonCode: null, message: 'ok' },
    ])
    expect(allApplied.fullyApplied).toBe(true)

    const empty = assembleActionBulkResults([])
    expect(empty.fullyApplied).toBe(false)
  })
})

describe('plugin-action-preview-boundary freshness & dry-run & reason codes', () => {
  it('来源签名失配可检出且索引低敏', () => {
    const recorded = [fixturePilotSourceRef()]
    const currentFresh = [fixturePilotSourceRef()]
    const currentChanged = [
      fixturePilotSourceRef({ contentDigest: 'ffeeddcc', capturedAt: '2026-08-24T08:05:00.000Z' }),
    ]
    expect(revalidateActionSourceRefs(currentFresh, recorded).fresh).toBe(true)
    const stale = revalidateActionSourceRefs(currentChanged, recorded)
    expect(stale.fresh).toBe(false)
    expect(stale.mismatchedIndexes).toEqual([0])
  })

  it('dry-run 门禁：canApply=false 阻断；blocking finding 不可确认', () => {
    expect(assertActionDryRunGate(true)).toBe(true)
    expect(assertActionDryRunGate(false)).toBe(false)

    const confirmable = fixturePilotPreviewWithDigest()
    expect(isActionPreviewConfirmable(confirmable)).toBe(true)

    const blocked = {
      ...confirmable,
      dryRun: {
        canApply: true,
        findings: [
          { code: 'compat-blocking', severity: 'blocking' as const, message: '兼容性阻断' },
        ],
      },
    }
    expect(isActionPreviewConfirmable(blocked)).toBe(false)
  })

  it('reason code 封闭集守卫：未知 code 不被接受', () => {
    expect(isPluginActionReasonCode('preview-stale')).toBe(true)
    expect(isPluginActionReasonCode('some-made-up-code')).toBe(false)
  })
})

describe('plugin-action-preview-boundary idempotency derivation', () => {
  it('相同语义动作得到同一幂等键', () => {
    const p = fixturePilotProposal()
    const digest = computeProposalDigest(p)
    const key = deriveActionIdempotencyKey({
      actionKind: p.actionKind,
      proposalDigest: digest,
      targetEntityRefs: ['plugin_pilot_item:new'],
      sourceRefs: p.sourceRefs,
    })
    const keyAgain = deriveActionIdempotencyKey({
      actionKind: p.actionKind,
      proposalDigest: computeProposalDigest(fixturePilotProposal()),
      targetEntityRefs: ['plugin_pilot_item:new'],
      sourceRefs: fixturePilotProposal().sourceRefs,
    })
    expect(key).toBe(keyAgain)
  })

  it('kind/目标/来源任一不同 → 幂等键不同', () => {
    const p = fixturePilotProposal()
    const digest = computeProposalDigest(p)
    const base = deriveActionIdempotencyKey({
      actionKind: p.actionKind,
      proposalDigest: digest,
      targetEntityRefs: ['plugin_pilot_item:new'],
      sourceRefs: p.sourceRefs,
    })
    const diffTarget = deriveActionIdempotencyKey({
      actionKind: p.actionKind,
      proposalDigest: digest,
      targetEntityRefs: ['plugin_pilot_item:other'],
      sourceRefs: p.sourceRefs,
    })
    const diffSource = deriveActionIdempotencyKey({
      actionKind: p.actionKind,
      proposalDigest: digest,
      targetEntityRefs: ['plugin_pilot_item:new'],
      sourceRefs: [fixturePilotSourceRef({ contentDigest: 'different' })],
    })
    expect(base).not.toBe(diffTarget)
    expect(base).not.toBe(diffSource)
  })
})
