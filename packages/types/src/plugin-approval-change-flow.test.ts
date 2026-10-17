import { describe, expect, it } from 'vitest'
import {
  boundChangeDiff,
  buildChangeConfirmHandle,
  changeFnv1a32,
  changeStableSerialize,
  checkMakerCheckerForChange,
  checkPermissionElevationBounds,
  computeChangeDecisionId,
  computeChangeDiffDigest,
  computeChangeHandleDigest,
  computePermissionDelta,
  isChangeRequestExpired,
  isChangeSensitiveKey,
  isChangeTerminalState,
  isPermissionElevation,
  isPluginChangeKind,
  isPluginChangeErrorCode,
  isPluginChangeRequestState,
  isValidChangeStateTransition,
  normalizeChangePermissionKeys,
  PLUGIN_CHANGE_KINDS,
  PLUGIN_CHANGE_REQUEST_STATES,
  sanitizeChangeForAudit,
  transitionChangeRequestState,
  validateChangeHandleBinding,
  type PluginChangeCanonicalDiff,
} from './plugin-approval-change-flow.js'
import {
  CHANGE_FIXTURE_ACTOR,
  CHANGE_FIXTURE_CHECKER,
  CHANGE_FIXTURE_NOW_ISO,
  createFixtureChangeRequest,
  createFixtureHandle,
  fixtureInstallDiff,
  fixturePermissionUpgradeDiff,
  fixtureVersionUpgradeDiff,
  SENSITIVE_CHANGE_SAMPLE,
} from './plugin-approval-change-flow-fixtures.js'

describe('plugin-approval-change-flow kinds & states', () => {
  it('covers the closed change kind set', () => {
    // v3-plugin-policy-bundles（design D4 兼容扩展）在首期三类之后追加 policy-bundle-change。
    // v3-organization-private-plugin-directory（design D2）追加 registry-release-change。
    expect(PLUGIN_CHANGE_KINDS).toEqual([
      'install',
      'permission-upgrade',
      'version-upgrade',
      'policy-bundle-change',
      'registry-release-change',
    ])
    for (const kind of PLUGIN_CHANGE_KINDS) expect(isPluginChangeKind(kind)).toBe(true)
    expect(isPluginChangeKind('uninstall')).toBe(false)
  })

  it('exposes nine request states and validates guards', () => {
    expect(PLUGIN_CHANGE_REQUEST_STATES).toHaveLength(9)
    for (const s of PLUGIN_CHANGE_REQUEST_STATES) {
      expect(isPluginChangeRequestState(s)).toBe(true)
    }
    expect(isPluginChangeRequestState('applied!')).toBe(false)
    expect(isPluginChangeErrorCode('plugin-change-stale')).toBe(true)
    expect(isPluginChangeErrorCode('other')).toBe(false)
  })
})

describe('state machine transitions', () => {
  it('walks the full approval path deterministically', () => {
    // draft -> pending-approval -> approved -> awaiting-confirmation -> applied
    expect(transitionChangeRequestState('draft', 'previewed', { approvalRequired: true })).toEqual({
      ok: true,
      next: 'pending-approval',
    })
    expect(transitionChangeRequestState('pending-approval', 'approved')).toEqual({
      ok: true,
      next: 'approved',
    })
    expect(transitionChangeRequestState('approved', 'confirmed')).toEqual({
      ok: true,
      next: 'awaiting-confirmation',
    })
    expect(transitionChangeRequestState('awaiting-confirmation', 'applied')).toEqual({
      ok: true,
      next: 'applied',
    })
  })

  it('skips approval when policy does not require it', () => {
    expect(transitionChangeRequestState('draft', 'previewed', { approvalRequired: false })).toEqual(
      {
        ok: true,
        next: 'awaiting-confirmation',
      },
    )
    expect(transitionChangeRequestState('draft', 'confirmed')).toEqual({
      ok: true,
      next: 'awaiting-confirmation',
    })
  })

  it('rejects illegal transitions with stable error codes', () => {
    // 审批 ≠ 确认：approved 不能直接 applied
    expect(transitionChangeRequestState('approved', 'applied')).toEqual({
      ok: false,
      error: 'plugin-change-illegal-transition',
    })
    // 终态不可转移
    for (const terminal of ['rejected', 'applied', 'withdrawn', 'expired'] as const) {
      expect(transitionChangeRequestState(terminal, 'confirmed').ok).toBe(false)
    }
    // draft 不能直接 applied
    expect(transitionChangeRequestState('draft', 'applied').ok).toBe(false)
    // pending-approval 不能直接 confirmed
    expect(transitionChangeRequestState('pending-approval', 'confirmed').ok).toBe(false)
  })

  it('allows failed retry only via re-preview to awaiting-confirmation', () => {
    expect(transitionChangeRequestState('failed', 'confirmed')).toEqual({
      ok: true,
      next: 'awaiting-confirmation',
    })
    expect(transitionChangeRequestState('failed', 'applied').ok).toBe(false)
  })

  it('marks terminal states and expiry deterministically', () => {
    expect(isChangeTerminalState('applied')).toBe(true)
    expect(isChangeTerminalState('awaiting-confirmation')).toBe(false)
    expect(isChangeRequestExpired('2026-08-24T10:00:00.000Z', '2026-08-24T10:00:00.000Z')).toBe(
      true,
    )
    expect(isChangeRequestExpired('2026-08-24T10:10:00.000Z', '2026-08-24T10:00:00.000Z')).toBe(
      false,
    )
    expect(isValidChangeStateTransition('draft', 'withdrawn')).toBe(true)
    expect(isValidChangeStateTransition('applied', 'withdrawn')).toBe(false)
  })

  it('enforces maker-checker separation on approve/reject', () => {
    expect(
      checkMakerCheckerForChange({
        event: 'approved',
        requesterRef: CHANGE_FIXTURE_ACTOR,
        decisionMakerRef: CHANGE_FIXTURE_CHECKER,
      }),
    ).toEqual({ ok: true })
    expect(
      checkMakerCheckerForChange({
        event: 'approved',
        requesterRef: CHANGE_FIXTURE_ACTOR,
        decisionMakerRef: CHANGE_FIXTURE_ACTOR,
      }),
    ).toEqual({ ok: false, code: 'plugin-change-self-approval-denied' })
    expect(
      checkMakerCheckerForChange({
        event: 'rejected',
        requesterRef: CHANGE_FIXTURE_ACTOR,
        decisionMakerRef: CHANGE_FIXTURE_ACTOR,
      }).ok,
    ).toBe(false)
  })
})

describe('canonical diff pure functions', () => {
  it('computes permission delta sorted and idempotent', () => {
    const delta = computePermissionDelta(['b', 'a'], ['a', 'c'])
    expect(delta.added).toEqual(['c'])
    expect(delta.removed).toEqual(['b'])
    expect(delta.unchanged).toEqual(['a'])
    // 幂等：同输入同输出
    expect(computePermissionDelta(['b', 'a'], ['a', 'c'])).toEqual(delta)
    // 输入顺序无关
    expect(computePermissionDelta(['a', 'b'], ['c', 'a'])).toEqual(delta)
  })

  it('normalizes permission keys (trim/dedupe/sort)', () => {
    expect(normalizeChangePermissionKeys([' x ', 'x', '', 'a'])).toEqual(['a', 'x'])
  })

  it('detects elevation and enforces fail-closed bounds', () => {
    const delta = computePermissionDelta(['read'], ['read', 'write'])
    expect(isPermissionElevation(delta)).toBe(true)
    expect(isPermissionElevation(computePermissionDelta(['read'], ['read']))).toBe(false)

    expect(checkPermissionElevationBounds(['read'], ['read', 'write'], ['read'])).toEqual({
      ok: true,
    })
    const denied = checkPermissionElevationBounds(['read', 'admin'], ['read'], ['read', 'admin'])
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.violations).toEqual(['admin'])
    // actor 与 org policy 任一不满足都拒绝
    expect(checkPermissionElevationBounds(['x'], [], ['x']).ok).toBe(false)
    expect(checkPermissionElevationBounds(['x'], ['x'], []).ok).toBe(false)
  })

  it('produces stable diff digests independent of key order', () => {
    const a: PluginChangeCanonicalDiff = fixtureInstallDiff()
    const b: PluginChangeCanonicalDiff = JSON.parse(JSON.stringify(a))
    expect(computeChangeDiffDigest(a)).toBe(computeChangeDiffDigest(b))
    // 内容变化 → digest 变化
    b.pluginId = 'org.example.other'
    expect(computeChangeDiffDigest(a)).not.toBe(computeChangeDiffDigest(b))
  })

  it('bounds oversized diffs and reports omitted count', () => {
    const big: PluginChangeCanonicalDiff = {
      ...fixtureInstallDiff(),
      permissionDelta: {
        added: Array.from({ length: 80 }, (_, i) => `p:${String(i).padStart(3, '0')}`),
        removed: [],
        unchanged: [],
      },
    }
    const bounded = boundChangeDiff(big)
    expect(bounded.diff.permissionDelta?.added).toHaveLength(64)
    expect(bounded.omitted).toBe(16)
  })

  it('registry-release-change diff carries action/status/impact and bounds instance ids', () => {
    // v3-organization-private-plugin-directory（design D2/D3）：目录四动作的 canonical diff。
    const base: PluginChangeCanonicalDiff = {
      kind: 'registry-release-change',
      pluginId: 'org.example.dev-toolkit',
      registryAction: 'rollback',
      versionDelta: {
        currentVersion: '1.2.0',
        targetVersion: '1.1.0',
        currentReleaseId: 11,
        targetReleaseId: 10,
      },
      compatibilityDigestBefore: 'sha256:aaa',
      compatibilityDigestAfter: 'sha256:bbb',
      affectedInstallationSummary: {
        activeCount: 3,
        uninstalledCount: 1,
        selectedInstanceIds: Array.from({ length: 80 }, (_, i) => i + 1),
      },
    }
    // 内容一致（键序无关）-> digest 稳定
    const copy: PluginChangeCanonicalDiff = JSON.parse(JSON.stringify(base))
    expect(computeChangeDiffDigest(base)).toBe(computeChangeDiffDigest(copy))
    // 状态/动作变化 -> digest 变化（before/after 摘要不可变性由 digest 绑定）
    copy.registryAction = 'disable'
    copy.releaseStatusDelta = { from: 'approved', to: 'withdrawn' }
    expect(computeChangeDiffDigest(base)).not.toBe(computeChangeDiffDigest(copy))
    // selectedInstanceIds 有界化
    const bounded = boundChangeDiff(base)
    expect(bounded.diff.affectedInstallationSummary?.selectedInstanceIds).toHaveLength(64)
    expect(bounded.omitted).toBe(16)
    expect(bounded.diff.affectedInstallationSummary?.activeCount).toBe(3)
  })
})

describe('confirm handle issuance & binding', () => {
  it('issues deterministic handles from server-side inputs', () => {
    const request = createFixtureChangeRequest()
    const h1 = createFixtureHandle(request)
    const h2 = createFixtureHandle(request)
    expect(h1.handle).toBe(h2.handle)
    expect(h1.handle.startsWith('chg-cfm-')).toBe(true)
    expect(h1.expiresAt).toBe('2026-08-24T10:10:00.000Z')
  })

  it('validates binding when nothing changed', () => {
    const request = createFixtureChangeRequest()
    const handle = createFixtureHandle(request)
    expect(
      validateChangeHandleBinding(handle, {
        requestId: request.id,
        organizationId: request.organizationId,
        projectId: request.projectId,
        actorRef: request.requestedBy,
        rowVersion: request.rowVersion,
        targetRevision: request.targetRevision,
        diffDigest: request.diffDigest,
        permissionDigest: request.permissionDigest,
        compatibilityDigest: request.compatibilityDigest,
        nowIso: CHANGE_FIXTURE_NOW_ISO,
      }),
    ).toEqual({ valid: true })
  })

  it('returns stale for any changed bound value', () => {
    const request = createFixtureChangeRequest()
    const handle = createFixtureHandle(request)
    const base = {
      requestId: request.id,
      organizationId: request.organizationId,
      projectId: request.projectId,
      actorRef: request.requestedBy,
      rowVersion: request.rowVersion,
      targetRevision: request.targetRevision,
      diffDigest: request.diffDigest,
      permissionDigest: request.permissionDigest,
      compatibilityDigest: request.compatibilityDigest,
      nowIso: CHANGE_FIXTURE_NOW_ISO,
    }
    // release 被替换（target revision 变化）
    expect(validateChangeHandleBinding(handle, { ...base, targetRevision: 'release-999' })).toEqual(
      {
        valid: false,
        error: 'plugin-change-stale',
        reason: expect.any(String),
      },
    )
    // rowVersion 前进
    expect(
      validateChangeHandleBinding(handle, { ...base, rowVersion: request.rowVersion + 1 }).error,
    ).toBe('plugin-change-stale')
    // diff 变化
    expect(validateChangeHandleBinding(handle, { ...base, diffDigest: 'other' }).error).toBe(
      'plugin-change-stale',
    )
  })

  it('rejects expired, cross-org, wrong-actor and forged handles', () => {
    const request = createFixtureChangeRequest()
    const handle = createFixtureHandle(request, { ttlSeconds: -1 })
    const base = {
      requestId: request.id,
      organizationId: request.organizationId,
      projectId: request.projectId,
      actorRef: request.requestedBy,
      rowVersion: request.rowVersion,
      targetRevision: request.targetRevision,
      diffDigest: request.diffDigest,
      permissionDigest: request.permissionDigest,
      compatibilityDigest: request.compatibilityDigest,
      nowIso: CHANGE_FIXTURE_NOW_ISO,
    }
    expect(validateChangeHandleBinding(handle, base).error).toBe('plugin-change-handle-expired')
    expect(validateChangeHandleBinding(handle, { ...base, organizationId: '2' }).error).toBe(
      'plugin-change-cross-org',
    )
    expect(validateChangeHandleBinding(handle, { ...base, actorRef: 'user-other' }).error).toBe(
      'plugin-change-permission-denied',
    )
    // 篡改句柄值（用未过期句柄验证 digest 校验）
    const fresh = createFixtureHandle(request)
    const forged = { ...fresh, handle: 'chg-cfm-000000000000-2' }
    expect(validateChangeHandleBinding(forged, base).error).toBe('plugin-change-handle-invalid')
    // requestId 不匹配
    expect(validateChangeHandleBinding(fresh, { ...base, requestId: 'chg-req-other' }).error).toBe(
      'plugin-change-handle-invalid',
    )
  })

  it('handle digest covers every authority field', () => {
    const request = createFixtureChangeRequest()
    const partial = {
      requestId: request.id,
      organizationId: request.organizationId,
      projectId: request.projectId,
      actorRef: request.requestedBy,
      rowVersion: request.rowVersion,
      targetRevision: request.targetRevision,
      diffDigest: request.diffDigest,
      permissionDigest: request.permissionDigest,
      compatibilityDigest: request.compatibilityDigest,
      expiresAt: request.expiresAt,
    }
    const d1 = computeChangeHandleDigest(partial)
    const d2 = computeChangeHandleDigest({ ...partial, targetRevision: 'release-103' })
    const d3 = computeChangeHandleDigest({ ...partial, projectId: 'proj-1' })
    expect(d1).not.toBe(d2)
    expect(d1).not.toBe(d3)
  })
})

describe('decision id & low-sensitive sanitizer', () => {
  it('derives deterministic decision ids per idempotency key', () => {
    const a = computeChangeDecisionId('req-1', 'approved', 'idem-1')
    const b = computeChangeDecisionId('req-1', 'approved', 'idem-1')
    const c = computeChangeDecisionId('req-1', 'approved', 'idem-2')
    const d = computeChangeDecisionId('req-1', 'rejected', 'idem-1')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).not.toBe(d)
  })

  it('drops sensitive keys and redacts sensitive values', () => {
    const sanitized = sanitizeChangeForAudit(SENSITIVE_CHANGE_SAMPLE)
    expect(sanitized.apiToken).toBeUndefined()
    expect(sanitized.authorizationHeader).toBeUndefined()
    const nested = sanitized.nested as Record<string, unknown>
    expect(nested.clientSecret).toBeUndefined()
    expect(nested.note).toBe('normal value')
    expect(isChangeSensitiveKey('clientSecret')).toBe(true)
    expect(isChangeSensitiveKey('diffDigest')).toBe(false)
  })

  it('hash and serialize are deterministic', () => {
    expect(changeFnv1a32('abc')).toBe(changeFnv1a32('abc'))
    expect(changeStableSerialize({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}')
  })
})

describe('three-kind fixtures stay consistent', () => {
  it('builds coherent requests for install / permission-upgrade / version-upgrade', () => {
    for (const diff of [
      fixtureInstallDiff(),
      fixturePermissionUpgradeDiff(),
      fixtureVersionUpgradeDiff(),
    ]) {
      const request = createFixtureChangeRequest({ diff })
      expect(request.kind).toBe(diff.kind)
      expect(request.diffDigest).toBe(computeChangeDiffDigest(diff))
      const handle = createFixtureHandle(request)
      expect(handle.requestId).toBe(request.id)
    }
  })
})
