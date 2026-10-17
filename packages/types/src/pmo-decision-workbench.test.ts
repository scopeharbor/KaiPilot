import { describe, expect, it } from 'vitest'
import {
  PMO_DECISION_AUDIT_ALLOWED_METADATA_KEYS,
  PMO_DECISION_CASE_STATUSES,
  PMO_DECISION_CONTRACT_VERSION,
  PMO_DECISION_FIXTURE_MAX_CASES,
  PMO_DECISION_FIXTURE_MAX_PROJECTS,
  PMO_DECISION_HANDOFF_TARGET_VALUES,
  PMO_DECISION_LENS_ID_VALUES,
  PMO_DECISION_MAX_OPTIONS,
  PMO_DECISION_MIN_OPTIONS,
  PMO_DECISION_OUTCOME_ACTION_VALUES,
  PMO_DECISION_SOURCE_STATE_VALUES,
  PMO_DECISION_SOURCE_VALUES,
  canonicalizePmoDecisionValue,
  canTransitionPmoDecisionCase,
  comparePmoDecisionMeasures,
  composePmoDecisionSourceState,
  computePmoDecisionContentHash,
  computePmoDecisionHandoffIdempotencyKey,
  computePmoDecisionOutcomeDigest,
  computePmoDecisionSnapshotHash,
  derivePmoDecisionSnapshotReadiness,
  isPmoDecisionCaseStatus,
  isPmoDecisionCaseTerminal,
  isPmoDecisionHandoffTarget,
  isPmoDecisionLensId,
  isPmoDecisionOutcomeAction,
  isPmoDecisionSource,
  isPmoDecisionSourceState,
  issuePmoDecisionReviewFingerprint,
  locatePmoDecisionStaleReason,
  normalizePmoDecisionCaseListQuery,
  pmoDecisionOutcomeRequiresSelectedOption,
  pmoDecisionScanPasses,
  pmoDecisionStableHash,
  redactPmoDecisionAuditMetadata,
  scanPmoDecisionSensitive,
  verifyPmoDecisionReviewFingerprint,
} from './pmo-decision-workbench.js'
import type { PmoDecisionRevisionBinding } from './pmo-decision-workbench.js'
import {
  pmoDecisionApproveOutcomeFixture,
  pmoDecisionComparableMeasures,
  pmoDecisionIncompatibleMeasures,
  pmoDecisionLargePortfolioFixture,
  pmoDecisionMaliciousPluginPayloadFixture,
  pmoDecisionPendingHandoffFixture,
  pmoDecisionSmallCaseFixture,
} from './pmo-decision-workbench-fixtures.js'

const FIXED_NOW = Date.parse('2026-08-24T12:00:00.000Z')

describe('pmo-decision-workbench 契约闭集与预算', () => {
  it('导出稳定契约版本与预算常量', () => {
    expect(PMO_DECISION_CONTRACT_VERSION).toBe('pmo-decision-workbench.v1')
    expect(PMO_DECISION_MIN_OPTIONS).toBe(2)
    expect(PMO_DECISION_MAX_OPTIONS).toBe(5)
    expect(PMO_DECISION_FIXTURE_MAX_PROJECTS).toBe(1000)
    expect(PMO_DECISION_FIXTURE_MAX_CASES).toBe(100)
  })

  it('闭集守卫拒绝未知值', () => {
    expect(isPmoDecisionCaseStatus('archived')).toBe(false)
    expect(isPmoDecisionCaseStatus(PMO_DECISION_CASE_STATUSES.DRAFT)).toBe(true)
    expect(isPmoDecisionSource('crm_pipeline')).toBe(false)
    expect(isPmoDecisionSource(PMO_DECISION_SOURCE_VALUES[0])).toBe(true)
    expect(isPmoDecisionSourceState('zero-filled')).toBe(false)
    expect(isPmoDecisionLensId('universal_score')).toBe(false)
    expect(isPmoDecisionOutcomeAction('auto-approve')).toBe(false)
    expect(isPmoDecisionHandoffTarget('direct_apply')).toBe(false)
    expect(PMO_DECISION_HANDOFF_TARGET_VALUES).not.toContain('direct_apply')
  })
})

describe('case 生命周期状态机（task 2.2）', () => {
  const S = PMO_DECISION_CASE_STATUSES

  it.each([
    [S.DRAFT, S.COLLECTING_EVIDENCE],
    [S.COLLECTING_EVIDENCE, S.READY_FOR_REVIEW],
    [S.COLLECTING_EVIDENCE, S.DRAFT],
    [S.READY_FOR_REVIEW, S.UNDER_REVIEW],
    [S.READY_FOR_REVIEW, S.COLLECTING_EVIDENCE],
    [S.UNDER_REVIEW, S.DECIDED],
    [S.UNDER_REVIEW, S.DEFERRED],
    [S.UNDER_REVIEW, S.COLLECTING_EVIDENCE],
    [S.DECIDED, S.SUPERSEDED],
    [S.DEFERRED, S.SUPERSEDED],
  ])('允许 %s → %s', (from, to) => {
    expect(canTransitionPmoDecisionCase(from, to)).toEqual({ allowed: true, reason: null })
  })

  it.each([
    [S.DRAFT, S.DECIDED],
    [S.DRAFT, S.SUPERSEDED],
    [S.COLLECTING_EVIDENCE, S.DECIDED],
    [S.READY_FOR_REVIEW, S.DEFERRED],
    [S.DECIDED, S.DEFERRED],
    [S.DEFERRED, S.DECIDED],
    [S.SUPERSEDED, S.DRAFT],
    [S.SUPERSEDED, S.UNDER_REVIEW],
  ])('拒绝 %s → %s', (from, to) => {
    const result = canTransitionPmoDecisionCase(from, to)
    expect(result.allowed).toBe(false)
    expect(result.reason).not.toBeNull()
  })

  it('终态不可变：superseded 无任何出边；decided/deferred 仅可 supersede', () => {
    expect(canTransitionPmoDecisionCase(S.SUPERSEDED, S.DRAFT).reason).toBe('TERMINAL_IMMUTABLE')
    expect(canTransitionPmoDecisionCase(S.DECIDED, S.UNDER_REVIEW).allowed).toBe(false)
    expect(isPmoDecisionCaseTerminal(S.DECIDED)).toBe(true)
    expect(isPmoDecisionCaseTerminal(S.COLLECTING_EVIDENCE)).toBe(false)
  })

  it('request-more-evidence 目标为 collecting-evidence 回退', () => {
    expect(canTransitionPmoDecisionCase(S.UNDER_REVIEW, S.COLLECTING_EVIDENCE).allowed).toBe(true)
  })
})

describe('canonicalization 与 snapshot hash（task 2.3）', () => {
  it('乱序键输入产生相同 hash', () => {
    const a = { b: 1, a: { y: 2, x: 3 } }
    const b = { a: { x: 3, y: 2 }, b: 1 }
    expect(computePmoDecisionContentHash(a)).toBe(computePmoDecisionContentHash(b))
  })

  it('非语义字段（collectedAt）不影响 hash，语义变化改变 hash', () => {
    const base = { sources: [{ key: 'k', value: 1 }], collectedAt: '2026-01-01T00:00:00Z' }
    const otherTime = { ...base, collectedAt: '2030-06-06T00:00:00Z' }
    expect(computePmoDecisionContentHash(base)).toBe(computePmoDecisionContentHash(otherTime))
    const semanticChange = { ...base, sources: [{ key: 'k', value: 2 }] }
    expect(computePmoDecisionContentHash(base)).not.toBe(
      computePmoDecisionContentHash(semanticChange),
    )
  })

  it('hidden/forbidden/unavailable 不与零值等价', () => {
    const zeroFact = [{ key: 'riskCount', value: 0 }]
    const forbiddenFact = [] as Array<{ key: string; value: number }>
    expect(JSON.stringify(zeroFact)).not.toBe(JSON.stringify(forbiddenFact))
    expect(composePmoDecisionSourceState({ unavailable: true })).not.toBe(
      // unavailable 状态不能被表达为 available + 零事实
      'available',
    )
  })

  it('快照 hash 覆盖组织/case/revision/sources', () => {
    const base = { organizationId: 1, caseId: 101, snapshotRevision: 1, sources: [{ s: 'a' }] }
    expect(computePmoDecisionSnapshotHash(base)).toBe(computePmoDecisionSnapshotHash(base))
    expect(computePmoDecisionSnapshotHash(base)).not.toBe(
      computePmoDecisionSnapshotHash({ ...base, organizationId: 2 }),
    )
    expect(pmoDecisionStableHash('x')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('数值精度归一避免浮点抖动', () => {
    expect(canonicalizePmoDecisionValue(0.1 + 0.2)).toBe(0.3)
    expect(canonicalizePmoDecisionValue(Number.NaN)).toBeNull()
  })
})

describe('来源状态合成与快照 readiness（task 2.4）', () => {
  it('优先级：forbidden > unavailable > stale > truncated > available', () => {
    expect(composePmoDecisionSourceState({ forbidden: true, stale: true })).toBe('forbidden')
    expect(composePmoDecisionSourceState({ unavailable: true, stale: true })).toBe('unavailable')
    expect(composePmoDecisionSourceState({ stale: true, truncated: true })).toBe('stale')
    expect(composePmoDecisionSourceState({ truncated: true })).toBe('truncated')
    expect(composePmoDecisionSourceState({})).toBe('available')
  })

  it('required 来源失败阻塞；optional 失败降级；全部可用即 ready', () => {
    expect(
      derivePmoDecisionSnapshotReadiness({
        blocks: [{ source: 'portfolio_dashboard', state: 'unavailable' }],
        requiredSources: ['portfolio_dashboard'],
      }),
    ).toBe('blocked')
    expect(
      derivePmoDecisionSnapshotReadiness({
        blocks: [
          { source: 'portfolio_dashboard', state: 'available' },
          { source: 'risk_register', state: 'unavailable' },
        ],
        requiredSources: ['portfolio_dashboard'],
      }),
    ).toBe('degraded')
    expect(
      derivePmoDecisionSnapshotReadiness({
        blocks: [{ source: 'portfolio_dashboard', state: 'available' }],
        requiredSources: ['portfolio_dashboard'],
      }),
    ).toBe('ready')
  })
})

describe('对比 lens（task 2.5）', () => {
  it('同单位同窗口输出 delta 且不改写源值', () => {
    const { baseline, candidate } = pmoDecisionComparableMeasures()
    const cell = comparePmoDecisionMeasures({ lensId: 'strategy_priority', baseline, candidate })
    expect(cell.comparable).toBe(true)
    expect(cell.delta).toBeCloseTo(8.75, 6)
    expect(cell.baselineValue).toBe(baseline.value)
    expect(cell.candidateValue).toBe(candidate.value)
  })

  it('单位不兼容标记 not-comparable 且无 winner 分数', () => {
    const { baseline, candidate } = pmoDecisionIncompatibleMeasures()
    const cell = comparePmoDecisionMeasures({
      lensId: 'investment_distribution',
      baseline,
      candidate,
    })
    expect(cell.comparable).toBe(false)
    expect(cell.notComparableReason).toBe('UNIT_MISMATCH')
    expect(cell.delta).toBeNull()
    expect(Object.keys(cell)).not.toContain('winner')
    expect(Object.keys(cell)).not.toContain('score')
  })

  it('缺值标记 MISSING_VALUE；相同输入输出稳定', () => {
    const { baseline } = pmoDecisionComparableMeasures()
    const cell = comparePmoDecisionMeasures({
      lensId: 'strategy_priority',
      baseline,
      candidate: { ...baseline, value: null },
    })
    expect(cell.notComparableReason).toBe('MISSING_VALUE')
    const again = comparePmoDecisionMeasures({
      lensId: 'strategy_priority',
      baseline,
      candidate: { ...baseline, value: null },
    })
    expect(cell).toEqual(again)
  })
})

describe('review fingerprint 与 TOCTOU（task 2.6）', () => {
  const binding: PmoDecisionRevisionBinding = {
    caseRevision: 3,
    optionRevisions: [2, 1],
    snapshotHash: 'deadbeef',
    sourceVersions: ['a.v1', 'b.v2'],
    permissionDigest: 'perm',
    participantDigest: 'part',
    lensVersions: ['lens.v1'],
  }

  function issue(bindingToIssue: PmoDecisionRevisionBinding, ttlMinutes?: number) {
    return issuePmoDecisionReviewFingerprint(bindingToIssue, { now: FIXED_NOW, ttlMinutes })
  }

  it('revision 未变且 TTL 内有效', () => {
    const fp = verifyPmoDecisionReviewFingerprint(issue(binding), binding, FIXED_NOW + 60_000)
    expect(fp.valid).toBe(true)
    expect(fp.staleReason).toBeNull()
  })

  it('TTL 过期失效', () => {
    const result = verifyPmoDecisionReviewFingerprint(
      issue(binding),
      binding,
      FIXED_NOW + 16 * 60_000,
    )
    expect(result.valid).toBe(false)
    expect(result.staleReason).toBe('TTL_EXPIRED')
  })

  it('任一 revision 维度变化都使旧 fingerprint 失效并定位原因', () => {
    expect(locatePmoDecisionStaleReason(binding, { ...binding, caseRevision: 4 })).toBe(
      'CASE_REVISION_CHANGED',
    )
    expect(locatePmoDecisionStaleReason(binding, { ...binding, optionRevisions: [2, 9] })).toBe(
      'OPTION_REVISION_CHANGED',
    )
    expect(locatePmoDecisionStaleReason(binding, { ...binding, snapshotHash: 'other' })).toBe(
      'SNAPSHOT_CHANGED',
    )
    expect(locatePmoDecisionStaleReason(binding, { ...binding, permissionDigest: 'p2' })).toBe(
      'PERMISSION_CHANGED',
    )
    expect(locatePmoDecisionStaleReason(binding, { ...binding, participantDigest: 'q' })).toBe(
      'PARTICIPANT_CHANGED',
    )
    expect(locatePmoDecisionStaleReason(binding, { ...binding, lensVersions: ['lens.v2'] })).toBe(
      'LENS_VERSION_CHANGED',
    )
    expect(locatePmoDecisionStaleReason(binding, { ...binding, sourceVersions: ['a.v2'] })).toBe(
      'SOURCE_VERSION_CHANGED',
    )

    for (const changed of [
      { ...binding, caseRevision: 4 },
      { ...binding, optionRevisions: [2, 9] },
      { ...binding, snapshotHash: 'other' },
      { ...binding, permissionDigest: 'p2' },
      { ...binding, participantDigest: 'q' },
      { ...binding, lensVersions: ['lens.v2'] },
      { ...binding, sourceVersions: ['a.v2'] },
    ]) {
      const result = verifyPmoDecisionReviewFingerprint(issue(binding), changed, FIXED_NOW)
      expect(result.valid).toBe(false)
      expect(result.staleReason).not.toBeNull()
    }
  })

  it('option 乱序传入不改变 fingerprint（排序归一）', () => {
    expect(issue({ ...binding, optionRevisions: [1, 2] }).fingerprint).toBe(
      issue(binding).fingerprint,
    )
  })
})

describe('outcome / handoff 幂等 digest（task 2.7）', () => {
  it('approve 缺选中方案时 digest 输入仍可构造，但 requiresSelectedOption 标记约束', () => {
    expect(pmoDecisionOutcomeRequiresSelectedOption('approve')).toBe(true)
    expect(pmoDecisionOutcomeRequiresSelectedOption('reject')).toBe(false)
    expect(pmoDecisionOutcomeRequiresSelectedOption('defer')).toBe(false)
  })

  it('相同 outcome payload 得到相同 digest，target 变化改变 handoff key', () => {
    const outcome = pmoDecisionApproveOutcomeFixture()
    const digestA = computePmoDecisionOutcomeDigest({
      action: outcome.action,
      organizationId: outcome.organizationId,
      caseId: outcome.caseId,
      selectedOptionId: outcome.selectedOptionId,
      snapshotHash: outcome.snapshotHash,
      reviewFingerprint: outcome.reviewFingerprint,
    })
    const digestB = computePmoDecisionOutcomeDigest({
      action: outcome.action,
      organizationId: outcome.organizationId,
      caseId: outcome.caseId,
      selectedOptionId: outcome.selectedOptionId,
      snapshotHash: outcome.snapshotHash,
      reviewFingerprint: outcome.reviewFingerprint,
    })
    expect(digestA).toBe(digestB)

    const receipt = pmoDecisionPendingHandoffFixture()
    const request = {
      organizationId: receipt.organizationId,
      caseId: receipt.caseId,
      outcomeDigest: '0badc0de',
      target: receipt.target,
      selectedOptionId: 2,
      actorId: receipt.actorId,
    }
    expect(computePmoDecisionHandoffIdempotencyKey(request)).toBe(
      computePmoDecisionHandoffIdempotencyKey(request),
    )
    expect(computePmoDecisionHandoffIdempotencyKey(request)).not.toBe(
      computePmoDecisionHandoffIdempotencyKey({
        ...request,
        target: 'priority_review_intent' as typeof request.target,
      }),
    )
  })
})

describe('深度脱敏与二次扫描（task 2.8）', () => {
  it('恶意插件负载被识别：嵌套对象与数组中的 secret 也无法逃逸', () => {
    const findings = scanPmoDecisionSensitive(pmoDecisionMaliciousPluginPayloadFixture())
    const kinds = new Set(findings.map((finding) => finding.kind))
    expect(kinds.has('secret-like-value')).toBe(true)
    expect(findings.some((finding) => finding.key === 'token')).toBe(true)
    expect(findings.some((finding) => finding.key === 'prompt')).toBe(true)
    expect(pmoDecisionScanPasses(pmoDecisionMaliciousPluginPayloadFixture())).toBe(false)
  })

  it('干净低敏元数据通过扫描', () => {
    const clean = { contractVersion: PMO_DECISION_CONTRACT_VERSION, caseId: 101, findingCount: 0 }
    expect(scanPmoDecisionSensitive(clean)).toHaveLength(0)
    expect(pmoDecisionScanPasses(clean)).toBe(true)
  })

  it('审计 metadata allowlist 只保留白名单键并剔除敏感值形态', () => {
    const raw = {
      caseId: 101,
      callbackUrl: 'https://evil.example.com/hook', // 非 allowlist 键 → 丢弃
      note: '内部异议全文', // 禁用键 → 丢弃
      authorization: 'Bearer abc.def.ghi', // 禁用键 → 丢弃
      warningCodes: [],
    }
    const redacted = redactPmoDecisionAuditMetadata(raw)
    expect(redacted).toEqual({ caseId: 101, warningCodes: [] })
    expect(
      Object.keys(redacted).every((key) =>
        (PMO_DECISION_AUDIT_ALLOWED_METADATA_KEYS as readonly string[]).includes(key),
      ),
    ).toBe(true)
  })

  it('URL/路径形态字符串值被二次扫描拦截', () => {
    expect(scanPmoDecisionSensitive('https://internal.example/api')).toHaveLength(1)
    expect(scanPmoDecisionSensitive('C:\\Users\\alice\\secret.txt')).toHaveLength(1)
  })
})

describe('fixtures（task 2.9）', () => {
  it('大规模 fixture 符合 1000/100/5 且无随机性', () => {
    const first = pmoDecisionLargePortfolioFixture()
    const second = pmoDecisionLargePortfolioFixture()
    expect(first.projectIds).toHaveLength(1000)
    expect(first.caseIds).toHaveLength(100)
    expect(first.optionsPerCase).toBe(5)
    expect(first.contentHashes).toEqual(second.contentHashes)
    expect(() => pmoDecisionLargePortfolioFixture(1001)).toThrow(/project budget/)
    expect(() => pmoDecisionLargePortfolioFixture(1000, 101)).toThrow(/case budget/)
    expect(() => pmoDecisionLargePortfolioFixture(1000, 100, 6)).toThrow(/within 2\.\.5/)
  })

  it('小夹具结构确定', () => {
    expect(pmoDecisionSmallCaseFixture()).toEqual(pmoDecisionSmallCaseFixture())
  })
})

describe('query 归一化', () => {
  it('筛选、分页与排序收敛到有界归一化结果', () => {
    const normalized = normalizePmoDecisionCaseListQuery({
      status: ['draft', 'bogus' as never, 'under-review'],
      ownerId: [7, 8],
      page: 2,
      perPage: 500,
      sort: 'dueDate',
    })
    expect(normalized.statuses).toEqual(['draft', 'under-review'])
    expect(normalized.ownerIds).toEqual([7, 8])
    expect(normalized.perPage).toBeLessThanOrEqual(100)
    expect(normalized.page).toBe(2)
    expect(normalized.sort).toBe('dueDate')
  })
})
