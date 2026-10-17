// v3-resource-capacity-forecasting-closed-loop §2.4/2.6/2.8/2.10/2.12 —— 闭环纯函数测试。
// 覆盖：状态迁移矩阵、revision 并发、canonical packet 确定性/digest、overlay 正负夹具、
// suggestion 投影（零新总分/零 winner）、fingerprint TOCTOU 与 not-comparable。

import { describe, expect, it } from 'vitest'

import {
  RESOURCE_CAPACITY_LOOP_BUDGETS,
  RESOURCE_CAPACITY_LOOP_REASON_CODES,
  RESOURCE_CAPACITY_LOOP_STATES,
  type ResourceCapacityLoopCanonicalPacket,
  type ResourceCapacityLoopOverlay,
} from './resource-capacity-closed-loop.js'
import {
  alignBucketDate,
  canonicalizePacket,
  checkExpectedRevision,
  compareObservation,
  computeBaselineDigest,
  computeHandoffIdempotencyHash,
  computeOverlayDigest,
  computePacketDigest,
  computeSelectionFingerprint,
  computeSimulationDigest,
  evaluateLoopTransition,
  fnv1a32Loop,
  isTerminalLoopState,
  normalizedSkillKey,
  projectAllocationSuggestion,
  rejectNonHumanActor,
  roundLoopHours,
  simulateScenario,
  stableStringifyLoop,
  validateOverlays,
  validateOverlay,
  type CandidateInput,
  type OverlayValidationContext,
} from './resource-capacity-closed-loop-pure.js'

const S = RESOURCE_CAPACITY_LOOP_STATES
const R = RESOURCE_CAPACITY_LOOP_REASON_CODES

// ─── §2.4 状态迁移矩阵 ──────────────────────────────────────────────────────

describe('RCCL 纯函数：状态迁移矩阵', () => {
  const ok = (from: string, to: string) =>
    expect(evaluateLoopTransition({ from: from as never, to: to as never }).ok).toBe(true)
  const bad = (from: string, to: string) => {
    const r = evaluateLoopTransition({ from: from as never, to: to as never })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasonCode).toBe(R.REVISION_CONFLICT)
  }

  it('合法主链 draft→simulated→selected→handed-off→observing→reviewed→closed 全通', () => {
    ok(S.DRAFT, S.SIMULATED)
    ok(S.SIMULATED, S.SELECTED)
    ok(S.SELECTED, S.HANDED_OFF)
    ok(S.HANDED_OFF, S.OBSERVING)
    ok(S.OBSERVING, S.REVIEWED)
    ok(S.REVIEWED, S.CLOSED)
  })

  it('draft 直跳 handed-off 被拒绝', () => bad(S.DRAFT, S.HANDED_OFF))

  it('closed 重开被拒绝；cancelled 无出边', () => {
    for (const to of [
      S.DRAFT,
      S.SIMULATED,
      S.SELECTED,
      S.HANDED_OFF,
      S.OBSERVING,
      S.REVIEWED,
      S.CLOSED,
      S.CANCELLED,
    ]) {
      if (to === S.CLOSED) continue
      bad(S.CLOSED, to)
      bad(S.CANCELLED, to)
    }
  })

  it('任意非终态可转 cancelled', () => {
    for (const from of [S.DRAFT, S.SIMULATED, S.SELECTED, S.HANDED_OFF, S.OBSERVING, S.REVIEWED]) {
      ok(from, S.CANCELLED)
    }
  })

  it('selected 因 stale 回退 simulated 合法（重新模拟后须重新选择）', () =>
    ok(S.SELECTED, S.SIMULATED))

  it('未知状态迁移被拒绝', () => {
    const r = evaluateLoopTransition({ from: 'archived' as never, to: S.DRAFT })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasonCode).toBe(R.BUDGET_EXCEEDED)
  })

  it('终态判定与 revision 乐观锁', () => {
    expect(isTerminalLoopState(S.CLOSED)).toBe(true)
    expect(isTerminalLoopState(S.SELECTED)).toBe(false)

    expect(checkExpectedRevision(3, 3).ok).toBe(true)
    const conflict = checkExpectedRevision(2, 5)
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.reasonCode).toBe(R.REVISION_CONFLICT)
    expect(checkExpectedRevision(0, 1).ok).toBe(false)
  })

  it('非人类 selection 一律拒绝（规则/插件/AI/计划任务/置信度阈值）', () => {
    expect(rejectNonHumanActor('human_user').ok).toBe(true)
    for (const actor of ['rule', 'plugin', 'ai', 'scheduled_job', 'confidence_threshold']) {
      const r = rejectNonHumanActor(actor)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reasonCode).toBe(R.NON_HUMAN_ACTOR_REJECTED)
    }
    expect(rejectNonHumanActor('mystery_bot').ok).toBe(false)
  })
})

// ─── §2.6 canonical packet / digest ────────────────────────────────────────

function makeRawFact(over: Partial<Record<string, unknown>> = {}) {
  return {
    dimension: 'role' as const,
    dimensionKey: 'Backend',
    bucket: '2026-09-02',
    demandHours: 100.005,
    allocatedHours: 60.004,
    availableCapacityHours: 90,
    remainingCapacityHours: 30,
    factState: 'visible' as const,
    ...over,
  }
}

function makeSources(stale = false) {
  return [
    {
      sourceId: 'resource-pool',
      sourceVersion: '1',
      signature: 'sig-a',
      required: true,
      freshness: { generatedAt: '2026-08-24T10:00:00Z', stale },
      factState: 'visible' as const,
      warnings: [],
      truncated: false,
    },
    {
      sourceId: 'skill-matrix',
      sourceVersion: '1',
      signature: 'sig-b',
      required: false,
      freshness: { generatedAt: '2026-08-24T10:00:00Z', stale: false },
      factState: stale ? ('missing' as const) : ('visible' as const),
      warnings: [],
      truncated: false,
    },
  ]
}

describe('RCCL 纯函数：canonical packet 规范化与 digest（§2.6）', () => {
  it('确定性：同输入两次 canonicalize 输出 deep-equal 且 digest 相同', () => {
    const input = {
      scope: {
        granularity: 'week' as const,
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [7, 3],
      },
      facts: [makeRawFact()],
      skillEntries: [],
      sources: makeSources(),
      evidenceRefs: [],
    }
    const a = canonicalizePacket(input)
    const b = canonicalizePacket(JSON.parse(JSON.stringify(input)))
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value).toEqual(b.value)
      expect(computePacketDigest(a.value)).toBe(computePacketDigest(b.value))
    }
  })

  it('乱序输入归一为同一结果：facts/projectIds 排序去重', () => {
    const f1 = makeRawFact()
    const f2 = makeRawFact({ dimensionKey: 'frontend', bucket: '2026-09-03' })
    const a = canonicalizePacket({
      scope: {
        granularity: 'day',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [9, 1],
      },
      facts: [f1, f2],
      skillEntries: [],
      sources: makeSources(),
      evidenceRefs: [],
    })
    const b = canonicalizePacket({
      scope: {
        granularity: 'day',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [1, 9],
      },
      facts: [f2, f1],
      skillEntries: [],
      sources: [...makeSources()].reverse(),
      evidenceRefs: [],
    })
    if (a.ok && b.ok) {
      expect(computePacketDigest(a.value)).toBe(computePacketDigest(b.value))
      expect(a.value.facts.map((f) => f.dimensionKey)).toEqual(['backend', 'frontend'])
      expect(a.value.scope.projectIds).toEqual([1, 9])
    } else {
      throw new Error('canonicalize 失败')
    }
  })

  it('时区/粒度对齐：week 桶对齐周一、month 对齐 1 日、精度四舍五入且 -0 归 0', () => {
    expect(alignBucketDate('2026-09-02', 'week')).toBe('2026-08-31') // 周三 → 周一
    expect(alignBucketDate('2026-09-20', 'month')).toBe('2026-09-01')
    expect(alignBucketDate('2026-09-20T23:00:00+08:00', 'day')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(roundLoopHours(-0.001)).toBe(0)
    expect(roundLoopHours(3.14159)).toBe(3.14)
    expect(roundLoopHours(1.234)).toBe(1.23)
    expect(roundLoopHours(2.5)).toBe(2.5)
  })

  it('非语义采集时间不改变内容 digest：digest 输入不含 collectedAt', () => {
    // digest 只吃 packet 结构本身；两个仅 generatedAt 不同的来源摘要不影响语义投影。
    const s1 = makeSources()
    const s2 = JSON.parse(JSON.stringify(s1)) as ReturnType<typeof makeSources>
    s2[0]!.freshness.generatedAt = '2099-01-01T00:00:00Z'
    const p1 = canonicalizePacket({
      scope: {
        granularity: 'week',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [],
      },
      facts: [makeRawFact()],
      skillEntries: [],
      sources: s1,
      evidenceRefs: [],
    })
    const p2 = canonicalizePacket({
      scope: {
        granularity: 'week',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [],
      },
      facts: [makeRawFact()],
      skillEntries: [],
      sources: s2,
      evidenceRefs: [],
    })
    if (p1.ok && p2.ok) {
      const stripTime = (p: ResourceCapacityLoopCanonicalPacket) => ({
        ...p,
        sources: p.sources.map((s) => ({ ...s, freshness: { ...s.freshness, generatedAt: '' } })),
      })
      expect(computePacketDigest(stripTime(p1.value))).toBe(
        computePacketDigest(stripTime(p2.value)),
      )
    } else {
      throw new Error('canonicalize 失败')
    }
  })

  it('false-zero 防护：缺失/受限来源显式标记而非补零', () => {
    const p = canonicalizePacket({
      scope: {
        granularity: 'day',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [],
      },
      facts: [makeRawFact({ demandHours: 0, allocatedHours: 0, factState: 'redacted' })],
      skillEntries: [],
      sources: makeSources(),
      evidenceRefs: [],
    })
    if (p.ok) {
      expect(p.value.warnings).toContain('PARTIAL_VISIBILITY')
    } else {
      throw new Error('canonicalize 失败')
    }
  })

  it('required 来源失败 → readyForSimulation=false；optional 来源失败只降级 warning', () => {
    const poolSource = makeSources()[0]!
    const skillSource = makeSources()[1]!

    const requiredFailed = canonicalizePacket({
      scope: {
        granularity: 'day',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [],
      },
      facts: [],
      skillEntries: [],
      sources: [{ ...poolSource, factState: 'missing' as const }],
      evidenceRefs: [],
    })
    if (requiredFailed.ok) expect(requiredFailed.value.readyForSimulation).toBe(false)

    const optionalFailed = canonicalizePacket({
      scope: {
        granularity: 'day',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [],
      },
      facts: [],
      skillEntries: [],
      sources: [poolSource, { ...skillSource, factState: 'missing' as const }],
      evidenceRefs: [],
    })
    if (optionalFailed.ok) {
      expect(optionalFailed.value.readyForSimulation).toBe(true)
      expect(optionalFailed.value.warnings).toContain('SOURCE_DEGRADED')
    }
  })

  it('payload 上限：facts 超 20000 拒绝并返回 PAYLOAD_TOO_LARGE', () => {
    const many = Array.from(
      { length: RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_FACTS_PER_BASELINE + 1 },
      (_, i) => makeRawFact({ dimensionKey: `role-${i}` }),
    )
    const r = canonicalizePacket({
      scope: {
        granularity: 'day',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [],
      },
      facts: many,
      skillEntries: [],
      sources: makeSources(),
      evidenceRefs: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasonCode).toBe(R.PAYLOAD_TOO_LARGE)
  })

  it('隐藏 label 不进 canonical key：dimensionKey 统一小写 trim，原标签由调用方保留', () => {
    expect(normalizedSkillKey('  React   Frontend ')).toBe('react frontend')
  })
})

// ─── §2.8 overlay 正负夹具 ─────────────────────────────────────────────────

const ctx: OverlayValidationContext = {
  visibleProjectIds: [1, 2, 3],
  authorizedPreviewRefIds: ['preview-ok'],
  knownRequirementRefIds: ['req-1'],
  knownRoleKeys: ['backend'],
  knownSkillKeys: ['react frontend'],
}

describe('RCCL 纯函数：overlay 校验与模拟（§2.8）', () => {
  it('正夹具：project-scope include/exclude 合法', () => {
    const r = validateOverlay(
      { kind: 'project-scope', includeProjectIds: [1, 2], excludeProjectIds: [3] },
      ctx,
    )
    expect(r.ok).toBe(true)
  })

  it('负夹具：隐藏项目注入被拒（PERMISSION_CHANGED）', () => {
    const r = validateOverlay(
      { kind: 'project-scope', includeProjectIds: [999], excludeProjectIds: [] },
      ctx,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasonCode).toBe(R.PERMISSION_CHANGED)
  })

  it('负夹具：未知 kind、任意公式字段、HR/财务/工时字段全部拒绝', () => {
    expect(validateOverlay({ kind: 'auto-balance' }, ctx).ok).toBe(false)
    expect(
      validateOverlay(
        {
          kind: 'capacity-delta',
          role: 'backend',
          normalizedSkillKey: null,
          bucket: '2026-09-07',
          deltaHours: 40,
          formula: 'x*2',
        },
        ctx,
      ).ok,
    ).toBe(false)
    expect(
      validateOverlay(
        {
          kind: 'capacity-delta',
          role: 'backend',
          normalizedSkillKey: null,
          bucket: '2026-09-07',
          deltaHours: 40,
          salaryBudget: 5000,
        },
        ctx,
      ).ok,
    ).toBe(false)
    expect(
      validateOverlay(
        {
          kind: 'demand-shift',
          projectId: 1,
          requirementRefId: 'req-1',
          fromBucket: '2026-09-07',
          toBucket: '2026-09-14',
          overtimeHours: 10,
        },
        ctx,
      ).ok,
    ).toBe(false)
  })

  it('负夹具：allocation-preview-ref 引用未授权预览被拒', () => {
    const r = validateOverlay(
      { kind: 'allocation-preview-ref', previewRefId: 'preview-hidden' },
      ctx,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasonCode).toBe(R.PERMISSION_CHANGED)
  })

  it('capacity-delta：role/skill 二选一；deltaHours 越界拒绝；越界日期拒绝', () => {
    expect(
      validateOverlay(
        {
          kind: 'capacity-delta',
          role: null,
          normalizedSkillKey: null,
          bucket: '2026-09-07',
          deltaHours: 40,
        },
        ctx,
      ).ok,
    ).toBe(false)
    expect(
      validateOverlay(
        {
          kind: 'capacity-delta',
          role: 'backend',
          normalizedSkillKey: 'react frontend',
          bucket: '2026-09-07',
          deltaHours: 40,
        },
        ctx,
      ).ok,
    ).toBe(false)
    expect(
      validateOverlay(
        {
          kind: 'capacity-delta',
          role: 'backend',
          normalizedSkillKey: null,
          bucket: '2026-09-07',
          deltaHours: 99999,
        },
        ctx,
      ).ok,
    ).toBe(false)
    expect(
      validateOverlay(
        {
          kind: 'capacity-delta',
          role: 'backend',
          normalizedSkillKey: null,
          bucket: 'not-a-date',
          deltaHours: 40,
        },
        ctx,
      ).ok,
    ).toBe(false)
    expect(
      validateOverlay(
        {
          kind: 'capacity-delta',
          role: 'Backend ',
          normalizedSkillKey: null,
          bucket: '2026-09-07',
          deltaHours: 40,
        },
        ctx,
      ).ok,
    ).toBe(true)
  })

  it('数量上限：overlay 超过 20 个拒绝', () => {
    const raws = Array.from(
      { length: RESOURCE_CAPACITY_LOOP_BUDGETS.MAX_OVERLAYS_PER_SCENARIO + 1 },
      () => ({
        kind: 'project-scope',
        includeProjectIds: [],
        excludeProjectIds: [],
      }),
    )
    const r = validateOverlays(raws, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasonCode).toBe(R.PAYLOAD_TOO_LARGE)
  })

  it('capacity-delta 只改模拟供给：正式容量事实不变，行标 hypothetical', () => {
    const packet = packetOf([
      rowRole('backend', '2026-09-07', {
        demandHours: 80,
        allocatedHours: 50,
        availableCapacityHours: 60,
        remainingCapacityHours: 10,
      }),
    ])
    const r = simulateScenario(packet, [
      {
        kind: 'capacity-delta',
        role: 'backend',
        normalizedSkillKey: null,
        bucket: '2026-09-07',
        deltaHours: 40,
      },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.rows[0]!.availableCapacityHours).toBe(100)
      expect(r.value.rows[0]!.hypothetical).toBe(true)
      expect(packet.facts[0]!.availableCapacityHours).toBe(60) // 正式事实零改动
      expect(r.value.warnings).toContain('OVERLAY_HYPOTHETICAL')
    }
  })

  it('demand-shift 保持来源身份：只在项目维度内搬移需求，不改任务日期', () => {
    const packet = packetOf([
      rowProject('1', '2026-09-07', { demandHours: 40, allocatedHours: 10 }),
      rowProject('1', '2026-09-14', { demandHours: 0, allocatedHours: 0 }),
    ])
    const r = simulateScenario(packet, [
      {
        kind: 'demand-shift',
        projectId: 1,
        requirementRefId: 'req-1',
        fromBucket: '2026-09-07',
        toBucket: '2026-09-14',
      },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) {
      const from = r.value.rows.find((x) => x.bucket === '2026-09-07')!
      const to = r.value.rows.find((x) => x.bucket === '2026-09-14')!
      expect(from.demandHours).toBe(0)
      expect(to.demandHours).toBe(40)
      expect(to.hypothetical).toBe(true)
    }
  })

  it('project-scope 过滤可见项目集', () => {
    const packet = packetOf([rowProject('1', '2026-09-07', {}), rowProject('2', '2026-09-07', {})])
    const r = simulateScenario(packet, [
      { kind: 'project-scope', includeProjectIds: [], excludeProjectIds: [2] },
    ])
    if (r.ok) expect(r.value.rows.some((x) => x.dimensionKey === '2')).toBe(false)
  })

  it('baseline 未就绪时模拟 fail closed', () => {
    const packet = { ...packetOf([]), readyForSimulation: false }
    const r = simulateScenario(packet, [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasonCode).toBe(R.SOURCE_REQUIRED_FAILED)
  })

  it('overlay digest 与顺序无关但与内容敏感', () => {
    const a: ResourceCapacityLoopOverlay[] = [
      { kind: 'project-scope', includeProjectIds: [1], excludeProjectIds: [] },
      {
        kind: 'capacity-delta',
        role: 'backend',
        normalizedSkillKey: null,
        bucket: '2026-09-07',
        deltaHours: 40,
      },
    ]
    expect(computeOverlayDigest(a)).toBe(computeOverlayDigest([...a].reverse()))
    expect(computeOverlayDigest(a)).not.toBe(computeOverlayDigest([a[0]!]))
  })
})

// ─── §2.10 suggestion 投影 ─────────────────────────────────────────────────

function rowRole(key: string, bucket: string, over: Partial<Record<string, number>> = {}) {
  return {
    dimension: 'role' as const,
    dimensionKey: key,
    bucket,
    demandHours: 0,
    allocatedHours: 0,
    availableCapacityHours: 0,
    remainingCapacityHours: 0,
    gapHours: 0,
    factState: 'visible' as const,
    ...over,
  }
}

function rowProject(id: string, bucket: string, over: Partial<Record<string, number>> = {}) {
  return rowRole(id, bucket, { dimension: 'project' as const, ...over })
}

function rowSkill(key: string, bucket: string, over: Partial<Record<string, number>> = {}) {
  return rowRole(key, bucket, { dimension: 'skill' as const, ...over })
}

function packetOf(facts: ReturnType<typeof rowRole>[]): ResourceCapacityLoopCanonicalPacket {
  return {
    schemaVersion: 'resource-capacity-loop@1',
    scope: {
      granularity: 'week',
      windowStart: '2026-09-01',
      windowEnd: '2026-09-30',
      projectIds: [1, 2, 3],
    },
    unit: 'hours',
    facts: facts as ResourceCapacityLoopCanonicalPacket['facts'],
    skillEntries: [],
    sources: [],
    evidenceRefs: [],
    warnings: [],
    readyForSimulation: true,
  }
}

function candidate(over: Partial<CandidateInput> = {}): CandidateInput {
  return {
    candidateRefId: 'cand-1',
    resourceId: 11,
    resourceName: '资源甲',
    matcherProvenance: 'cross-project-allocation@listCandidates',
    existingScore: 87.5,
    matchedSkillKeys: ['react frontend'],
    missingSkillKeys: [],
    availableHoursPerBucket: [{ bucket: '2026-09-07', hours: 30 }],
    availabilityConflictBuckets: [],
    contentionSeverity: 'none',
    freshnessStale: false,
    hidden: false,
    evidenceRefs: [{ evidenceKey: 'e1', sourceId: 'candidates', refHash: 'h1' }],
    ...over,
  }
}

describe('RCCL 纯函数：allocation suggestion 投影（§2.10）', () => {
  const packet = packetOf([rowSkill('react frontend', '2026-09-07', { gapHours: 40 })])

  it('完全覆盖：covered=unmet，uncovered=0，保留 provenance 与原分数', () => {
    const r = projectAllocationSuggestion(packet, 'skill', 'React Frontend', [
      candidate({ availableHoursPerBucket: [{ bucket: '2026-09-07', hours: 45 }] }),
    ])
    if (r.ok) {
      expect(r.value.unmetDimensionKey).toBe('react frontend')
      const c = r.value.candidates[0]!.projection
      expect(c.coveredHoursPerBucket[0]).toEqual({ bucket: '2026-09-07', coveredHours: 40 })
      expect(c.uncoveredHoursPerBucket[0]).toEqual({ bucket: '2026-09-07', uncoveredHours: 0 })
      expect(c.matcherProvenance).toContain('listCandidates')
      expect(c.existingScore).toBe(87.5)
    } else {
      throw new Error('投影失败')
    }
  })

  it('部分容量：uncovered 显式保留，缺口不视为已解决', () => {
    const r = projectAllocationSuggestion(packet, 'skill', 'react frontend', [
      candidate({ availableHoursPerBucket: [{ bucket: '2026-09-07', hours: 25 }] }),
    ])
    if (r.ok) {
      expect(r.value.candidates[0]!.projection.coveredHoursPerBucket[0]!.coveredHours).toBe(25)
      expect(r.value.candidates[0]!.projection.uncoveredHoursPerBucket[0]!.uncoveredHours).toBe(15)
    }
  })

  it('缺技能 / 冲突桶：覆盖归零并保留 missing/conflict 信息', () => {
    const r = projectAllocationSuggestion(packet, 'skill', 'react frontend', [
      candidate({
        missingSkillKeys: ['node backend'],
        availabilityConflictBuckets: ['2026-09-07'],
        contentionSeverity: 'high',
      }),
    ])
    if (r.ok) {
      const c = r.value.candidates[0]!.projection
      expect(c.coveredHoursPerBucket[0]!.coveredHours).toBe(0)
      expect(c.missingSkillKeys).toContain('node backend')
      expect(c.availabilityConflictBuckets).toContain('2026-09-07')
      expect(c.contentionSeverity).toBe('high')
    }
  })

  it('stale/degraded：建议区 degraded 标记，不静默重排', () => {
    const r = projectAllocationSuggestion(packet, 'skill', 'react frontend', [
      candidate({ freshnessStale: true }),
    ])
    if (r.ok) expect(r.value.degraded).toBe(true)
  })

  it('隐藏候选整体剔除且不泄露存在性', () => {
    const visible = candidate({ candidateRefId: 'visible-1' })
    const hidden = candidate({ candidateRefId: 'hidden-1', hidden: true, resourceName: '机密资源' })
    const r = projectAllocationSuggestion(packet, 'skill', 'react frontend', [hidden, visible])
    if (r.ok) {
      expect(r.value.candidates).toHaveLength(1)
      expect(stableStringifyLoop(r.value)).not.toContain('hidden-1')
      expect(stableStringifyLoop(r.value)).not.toContain('机密资源')
    }
  })

  it('恒不产生新总分或 winner：输出无排序权重字段且保留原候选顺序', () => {
    const c1 = candidate({ candidateRefId: 'a', existingScore: 99 })
    const c2 = candidate({ candidateRefId: 'b', existingScore: 10 })
    const r = projectAllocationSuggestion(packet, 'skill', 'react frontend', [c1, c2])
    if (r.ok) {
      expect(r.value.candidates.map((c) => c.projection.candidateRefId)).toEqual(['a', 'b'])
      expect(stableStringifyLoop(r.value)).not.toContain('"winner"')
      expect(stableStringifyLoop(r.value)).not.toContain('"rankScore"')
    }
  })

  it('无缺口的维度拒绝投影', () => {
    const empty = packetOf([rowSkill('react frontend', '2026-09-07', { gapHours: 0 })])
    expect(projectAllocationSuggestion(empty, 'skill', 'react frontend', [candidate()]).ok).toBe(
      false,
    )
  })
})

// ─── §2.12 fingerprint / idempotency / comparability ──────────────────────

describe('RCCL 纯函数：指纹与复测（§2.12）', () => {
  const base = {
    packetDigest: 'fnv1a:aaaa',
    sourceSignaturesHash: 'fnv1a:bbbb',
    permissionFingerprint: 'fnv1a:cccc',
    scope: {
      granularity: 'week' as const,
      windowStart: '2026-09-01',
      windowEnd: '2026-09-30',
      projectIds: [1],
    },
  }

  it('来源/权限/scope 任一变化都改变 baselineDigest', () => {
    const d0 = computeBaselineDigest(base)
    expect(d0).toBe(computeBaselineDigest({ ...base }))
    expect(d0).not.toBe(computeBaselineDigest({ ...base, sourceSignaturesHash: 'fnv1a:zzzz' }))
    expect(d0).not.toBe(computeBaselineDigest({ ...base, permissionFingerprint: 'fnv1a:yyyy' }))
    expect(d0).not.toBe(
      computeBaselineDigest({ ...base, scope: { ...base.scope, projectIds: [2] } }),
    )
  })

  it('scenario/overlay/engine 变化改变 simulationDigest', () => {
    const sim = {
      baselineDigest: 'fnv1a:d0',
      scenarioRevision: 1,
      overlayDigest: 'fnv1a:o1',
      engineVersion: 'rccl-engine@1',
    }
    const d0 = computeSimulationDigest(sim)
    expect(d0).not.toBe(computeSimulationDigest({ ...sim, overlayDigest: 'fnv1a:o2' }))
    expect(d0).not.toBe(computeSimulationDigest({ ...sim, engineVersion: 'rccl-engine@2' }))
  })

  it('selectionFingerprint 重放一致；warning 承诺/actor/expiry/revision 变化即失效', () => {
    const sel = {
      simulationDigest: 'fnv1a:sim',
      actorUserId: 42,
      acknowledgedWarnings: ['LOW_CONFIDENCE'] as never[],
      expiresAt: '2026-08-28T00:00:00Z',
      loopRevision: 7,
    }
    const f0 = computeSelectionFingerprint(sel)
    expect(f0).toBe(computeSelectionFingerprint({ ...sel }))
    expect(f0).not.toBe(
      computeSelectionFingerprint({ ...sel, acknowledgedWarnings: [] as never[] }),
    )
    expect(f0).not.toBe(computeSelectionFingerprint({ ...sel, actorUserId: 43 }))
    expect(f0).not.toBe(computeSelectionFingerprint({ ...sel, loopRevision: 8 }))
    expect(f0).not.toBe(computeSelectionFingerprint({ ...sel, expiresAt: '2026-08-29T00:00:00Z' }))
  })

  it('handoff 幂等哈希：同 org+fingerprint+target+key 重放一致；跨租重放不同', () => {
    const input = {
      organizationId: 1,
      selectionFingerprint: 'fp',
      target: 'safe-navigation' as const,
      idempotencyKey: 'k1',
    }
    const h = computeHandoffIdempotencyHash(input)
    expect(h).toBe(computeHandoffIdempotencyHash(input))
    expect(h).not.toBe(computeHandoffIdempotencyHash({ ...input, organizationId: 2 }))
    expect(h).not.toBe(computeHandoffIdempotencyHash({ ...input, idempotencyKey: 'k2' }))
  })

  it('partial apply / 观测差值：observed−expected 即 forecast error，无因果措辞字段', () => {
    const out = compareObservation({
      baselineScope: {
        granularity: 'week',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [1],
      },
      observationScope: {
        granularity: 'week',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [1],
      },
      baselineMetricVersion: 'resource-capacity-loop@1',
      observationMetricVersion: 'resource-capacity-loop@1',
      expectedRows: [
        { dimension: 'skill', dimensionKey: 'react', bucket: '2026-09-07', gapHours: 40 },
      ],
      observedRows: [
        {
          dimension: 'skill',
          dimensionKey: 'react',
          bucket: '2026-09-07',
          observedGapHours: 25,
          observedAllocatedHours: 55,
          factState: 'visible',
        },
      ],
    })
    expect(out.comparability.comparable).toBe(true)
    expect(out.comparisons[0]!.forecastErrorHours).toBe(-15)
    expect(out.comparisons[0]!.unresolved).toBe(false)
    expect(stableStringifyLoop(out).toLowerCase()).not.toContain('caused')
  })

  it('metric/window/granularity/scope 失配 → not-comparable 且不给伪造改善百分比', () => {
    const mk = (over: Partial<Parameters<typeof compareObservation>[0]>) =>
      compareObservation({
        baselineScope: {
          granularity: 'week',
          windowStart: '2026-09-01',
          windowEnd: '2026-09-30',
          projectIds: [1],
        },
        observationScope: {
          granularity: 'week',
          windowStart: '2026-09-01',
          windowEnd: '2026-09-30',
          projectIds: [1],
        },
        baselineMetricVersion: 'v1',
        observationMetricVersion: 'v1',
        expectedRows: [],
        observedRows: [],
        ...over,
      })
    expect(mk({ observationMetricVersion: 'v2' }).comparability.reasonCodes).toContain(
      R.NOT_COMPARABLE_METRIC_VERSION,
    )
    expect(
      mk({
        observationScope: {
          granularity: 'week',
          windowStart: '2026-10-01',
          windowEnd: '2026-10-31',
          projectIds: [1],
        },
      }).comparability.reasonCodes,
    ).toContain(R.NOT_COMPARABLE_WINDOW)
    expect(
      mk({
        observationScope: {
          granularity: 'day',
          windowStart: '2026-09-01',
          windowEnd: '2026-09-30',
          projectIds: [1],
        },
      }).comparability.reasonCodes,
    ).toContain(R.NOT_COMPARABLE_GRANULARITY)
    const scopeChanged = mk({
      observationScope: {
        granularity: 'week',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-30',
        projectIds: [1, 2],
      },
    })
    expect(scopeChanged.comparability.reasonCodes).toContain(R.NOT_COMPARABLE_SCOPE)
    // not-comparable 时观测值一律置空。
    expect(
      scopeChanged.comparisons.every(
        (c) => c.observedGapHours === null && c.forecastErrorHours === null,
      ),
    ).toBe(true)
  })

  it('hash 工具：fnv1a32Loop 稳定且区分不同输入', () => {
    expect(fnv1a32Loop('abc')).toBe(fnv1a32Loop('abc'))
    expect(fnv1a32Loop('abc')).not.toBe(fnv1a32Loop('abd'))
    expect(fnv1a32Loop('')).toMatch(/^fnv1a:[0-9a-f]{8}$/)
  })
})
