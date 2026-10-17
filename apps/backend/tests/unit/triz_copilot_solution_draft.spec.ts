// v3-triz-contradiction-copilot tasks 1.5 —— Top 3 破局方案草案服务单测。
//
// 覆盖（tasks 1.5 验收 + spec「Top 3 破局方案呈现与原则溯源」第 1–5 条 + design D2/D6、
// 「红线守卫设计」RL-02/RL-03/RL-10/RL-12 行）：
// - 数量：候选多于 3 条时只输出 3 条；不足 3 条时按知识包确定性补足，无法补足时如实少于 3 条；
// - 确定性：同一输入两次调用结果深度相等；候选数组顺序被打乱不影响结果；排序分量按命名权重复算；
// - 反幻觉：实体引用逐个过 1.3 白名单，编造引用被剔除且只记计数；上下文无实体时降级为通用建议并显式标注；
// - 溯源：来源原则编号与名称一律回填知识包（不采信输入草案的名称字段），展开解释字段齐全；
// - 只产草案：`persisted: false` / `requiresHumanConfirmation: true`；静态扫描无数据访问与写入特征；
// - 零模型调用：模块内不出现 AIGateway / 适配器解析 / ai_m0 依赖（纯确定性组装）。
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { TRIZ_KNOWLEDGE_PACK_VERSION } from '#services/triz_copilot/knowledge/index'
import { searchPrincipleByNumber } from '#services/triz_copilot/triz_knowledge_search_service'
import {
  TRIZ_CONTEXT_PACK_LIMITS,
  isContextRefWhitelisted,
  type TrizContextPack,
  type TrizContextTrimmedDomain,
} from '#services/triz_copilot/triz_context_pack_service'
import {
  toTrizCandidatePrincipleRef,
  toTrizParameterRef,
  type TrizCandidatePrincipleRef,
  type TrizContradictionMappingDraft,
} from '#services/triz_copilot/triz_contradiction_mapping_service'
import TrizSolutionDraftService, {
  TRIZ_SOLUTION_LIMITS,
  TRIZ_SOLUTION_QUALITY_FLAGS,
  TRIZ_SOLUTION_RANKING_WEIGHTS,
  TRIZ_SOLUTION_TOP_COUNT,
  buildTrizSolutionDrafts,
  resolveTrizSolutionLimits,
  toTrizSolutionLowSensitivityRecord,
  type TrizSolutionDraftSet,
} from '#services/triz_copilot/triz_solution_draft_service'

const SERVICE_RELATIVE_PATH = '../../app/services/triz_copilot/triz_solution_draft_service.ts'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

/** 数据访问 / 写入特征（正则只看代码形态，不覆盖中文文案）。 */
const WRITE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/#models\//i, 'models 子路径导入'],
  [/@adonisjs\/lucid/i, 'Lucid ORM'],
  [/\brawQuery\s*\(/i, 'rawQuery'],
  [/\.query\s*\(/i, '查询构造器'],
  [/\bdb\.(from|table)\s*\(/i, 'db 直连表访问'],
  [/\.insert\s*\(/i, 'insert'],
  [/\bupdate\s*\(\s*\{/i, 'update'],
  [/\.delete\s*\(/i, 'delete'],
  [/\.save\s*\(/i, 'save'],
  [/\.create\s*\(/i, 'create'],
  [/\btrx\b/i, '事务对象'],
  [/\btransaction\b/i, '事务'],
]

/** 模型通道特征：本服务为纯确定性组装，任何一条命中都说明它被接进了模型链路。 */
const MODEL_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/AIGateway/i, 'AIGateway'],
  [/resolveAdapter/i, '适配器解析'],
  [/ai_m0|ai_gateway/i, '模型网关模块'],
  [/providerCalls/i, '模型调用计数'],
]

const ORG_ID = 11
const PROJECT_ID = 22

const WHITELIST_REFS = [
  'task:1',
  'task:2',
  'task:3',
  'risk:1',
  'risk:2',
  'resource:1',
  'milestone:1',
  'change_request:1',
]

/** 手工构造的上下文包：本服务只消费包，不重新读业务数据（零 DB 依赖）。 */
function makePack(overrides: Partial<TrizContextPack> = {}): TrizContextPack {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    capturedAt: '2026-09-11T00:00:00.000Z',
    asOfDate: '2026-09-11',
    domains: {
      tasks: {
        readings: {
          total: 3,
          criticalPathCount: 2,
          overdueCount: 1,
          schedule: { spi: 0.92, sv: -3, scheduleStatus: 'delayed', hasBaseline: true },
        },
        items: [
          {
            id: 1,
            label: '逾期关键任务：联调排期',
            status: 'in_progress',
            priority: 'high',
            progressPercent: 40,
            isCriticalPath: true,
            overdue: true,
            startDate: null,
            endDate: '2026-09-01',
            milestoneId: null,
            assigneeId: null,
          },
          {
            id: 2,
            label: 'CI 流水线建设',
            status: 'in_progress',
            priority: 'medium',
            progressPercent: 60,
            isCriticalPath: true,
            overdue: false,
            startDate: null,
            endDate: '2026-09-20',
            milestoneId: 1,
            assigneeId: null,
          },
          {
            id: 3,
            label: '未开始任务',
            status: 'not_started',
            priority: 'low',
            progressPercent: 0,
            isCriticalPath: false,
            overdue: false,
            startDate: null,
            endDate: null,
            milestoneId: null,
            assigneeId: null,
          },
        ],
        criticalPathTaskIds: [1, 2],
        truncated: false,
      },
      risks: {
        readings: { total: 2, matrixCells: [{ probability: 3, impact: 4, count: 1 }] },
        items: [
          {
            id: 1,
            label: '关键路径延期风险',
            category: 'schedule',
            riskLevel: 'high',
            status: 'identified',
            priority: 'high',
            score: 12,
            probability: 3,
            impact: 4,
          },
          {
            id: 2,
            label: '范围蔓延风险',
            category: 'scope',
            riskLevel: 'medium',
            status: 'identified',
            priority: 'medium',
            score: 6,
            probability: 2,
            impact: 3,
          },
        ],
        truncated: false,
      },
      resources: {
        readings: {
          windowFrom: '2026-09-11',
          windowTo: '2026-09-24',
          resourceCount: 1,
          teamAverageUtilizationPercent: 118,
          overloadedResourceCount: 1,
        },
        items: [
          {
            id: 1,
            label: '工程师A',
            role: 'developer',
            dailyCapacityHours: 8,
            utilizationPercent: 118,
            peakDayUtilizationPercent: 130,
            overallocated: true,
          },
        ],
        truncated: false,
      },
      milestones: {
        readings: { total: 1, byDisplayStatus: { at_risk: 1 } },
        items: [
          {
            id: 1,
            label: 'M1 联调完成',
            displayStatus: 'at_risk',
            storedStatus: 'planned',
            plannedDate: '2026-09-30',
            derived: false,
          },
        ],
        truncated: false,
      },
      changeRequests: {
        readings: { total: 1, pendingApprovalCount: 1 },
        items: [
          {
            id: 1,
            label: '追加灰度发布窗口',
            changeType: 'scope',
            status: 'submitted',
            priority: 'high',
          },
        ],
        truncated: false,
      },
    },
    entityWhitelist: {
      taskIds: [1, 2, 3],
      riskIds: [1, 2],
      resourceIds: [1],
      milestoneIds: [1],
      changeRequestIds: [1],
      refs: [...WHITELIST_REFS],
    },
    trimmedDomains: [],
    warnings: [],
    truncated: false,
    limits: { ...TRIZ_CONTEXT_PACK_LIMITS },
    ...overrides,
  }
}

/** 无任何可用实体的上下文包（逐域无权限裁剪）：用于通用建议降级路径。 */
function makeEmptyPack(): TrizContextPack {
  const trimmed: TrizContextTrimmedDomain[] = [
    { domain: 'tasks', requiredPermission: 'task:view', reason: 'missing_permission' },
    { domain: 'risks', requiredPermission: 'risk:view', reason: 'missing_permission' },
    { domain: 'resources', requiredPermission: 'resource:view', reason: 'missing_permission' },
    { domain: 'milestones', requiredPermission: 'milestone:view', reason: 'missing_permission' },
    {
      domain: 'changeRequests',
      requiredPermission: 'change_request:create',
      reason: 'missing_permission',
    },
  ]
  return makePack({
    domains: {},
    entityWhitelist: {
      taskIds: [],
      riskIds: [],
      resourceIds: [],
      milestoneIds: [],
      changeRequestIds: [],
      refs: [],
    },
    trimmedDomains: trimmed,
    warnings: ['DOMAIN_TRIMMED'],
  })
}

/** 候选原则：编号取自知识包（rank 从 1 起）。 */
function candidatesOf(numbers: readonly number[]): TrizCandidatePrincipleRef[] {
  return numbers
    .map((number, index) => toTrizCandidatePrincipleRef(number, index + 1))
    .filter((entry): entry is TrizCandidatePrincipleRef => entry !== null)
}

/** 手工构造的映射草案（1.4 的产出形态）：本服务只消费草案，不重新映射。 */
function makeMapping(
  overrides: Partial<TrizContradictionMappingDraft> = {},
): TrizContradictionMappingDraft {
  return {
    path: 'rule',
    contradictionType: 'technical',
    contradictionTypeLabel: '技术矛盾',
    improvingParameter: toTrizParameterRef(25),
    worseningParameter: toTrizParameterRef(27),
    candidatePrinciples: candidatesOf([10, 28, 24]),
    confidence: 0.72,
    contextRefs: ['task:1', 'risk:1'],
    contextRefValidation: { accepted: 2, rejected: 0 },
    sourceMappingIds: ['PM-01'],
    sourceSections: ['triz-application-ai-pm.md §三 · 矛盾对 1'],
    requiresHumanConfirmation: true,
    persisted: false,
    needsClarification: false,
    fallbackReasons: ['MODEL_DISABLED'],
    qualityFlags: [],
    statementDigest: 'a'.repeat(32),
    statementLength: 24,
    statementTruncated: false,
    knowledgePackVersion: TRIZ_KNOWLEDGE_PACK_VERSION,
    ...overrides,
  }
}

function build(
  mapping: TrizContradictionMappingDraft,
  pack: TrizContextPack = makePack(),
): TrizSolutionDraftSet {
  return buildTrizSolutionDrafts({ mapping, contextPack: pack })
}

// ---------------------------------------------------------------------------
// 数量与排序
// ---------------------------------------------------------------------------

test.group('TRIZ 方案草案 · 数量与确定性排序', () => {
  test('候选多于 3 条时只输出 3 条，第 4 条及以后只留在编号清单', ({ assert }) => {
    const mapping = makeMapping({
      candidatePrinciples: candidatesOf([10, 28, 24, 1, 35, 19]),
    })
    const set = build(mapping)

    assert.lengthOf(set.solutions, TRIZ_SOLUTION_TOP_COUNT)
    assert.deepEqual(
      set.solutions.map((solution) => solution.index),
      [1, 2, 3],
    )
    assert.deepEqual(
      set.solutions.map((solution) => solution.principle.number),
      [10, 28, 24],
      'Top 3 取知识包推荐序中得分最高的三条',
    )
    assert.lengthOf(set.excludedPrincipleNumbers, 3)
    assert.deepEqual(set.excludedPrincipleNumbers, [1, 35, 19])
    assert.deepEqual(set.candidatePrincipleNumbers, [10, 28, 24, 1, 35, 19])
    assert.include(set.qualityFlags, 'CANDIDATES_TRUNCATED')
    assert.notInclude(set.qualityFlags, 'SOLUTION_COUNT_UNDER_LIMIT')
  })

  test('同一分析记录重算排序完全一致（两次调用深度相等）', ({ assert }) => {
    const service = new TrizSolutionDraftService()
    const first = service.build({ mapping: makeMapping(), contextPack: makePack() })
    const second = service.build({ mapping: makeMapping(), contextPack: makePack() })
    assert.deepEqual(first, second)
  })

  test('候选数组顺序被打乱（rank 不变）不影响结果', ({ assert }) => {
    const shuffled = [...makeMapping().candidatePrinciples].reverse()
    const baseline = build(makeMapping())
    const reordered = build(makeMapping({ candidatePrinciples: shuffled }))
    assert.deepEqual(reordered, baseline)
  })

  test('排序分量与命名权重可复算，且分数单调不增', ({ assert }) => {
    const set = build(makeMapping({ candidatePrinciples: candidatesOf([10, 28, 24, 1, 35, 19]) }))
    assert.equal(TRIZ_SOLUTION_TOP_COUNT, 3)

    for (const solution of set.solutions) {
      const { principleStrength, contextMatch, executability } = solution.ranking
      for (const component of [principleStrength, contextMatch, executability]) {
        assert.isAtLeast(component, 0)
        assert.isAtMost(component, 1)
      }
      const recomputed =
        TRIZ_SOLUTION_RANKING_WEIGHTS.principleStrength * principleStrength +
        TRIZ_SOLUTION_RANKING_WEIGHTS.contextMatch * contextMatch +
        TRIZ_SOLUTION_RANKING_WEIGHTS.executability * executability
      assert.closeTo(solution.ranking.score, recomputed, 0.001)
    }

    for (let index = 1; index < set.solutions.length; index += 1) {
      assert.isAtMost(
        set.solutions[index].ranking.score,
        set.solutions[index - 1].ranking.score,
        '方案必须按分数降序排列',
      )
    }

    const weightSum =
      TRIZ_SOLUTION_RANKING_WEIGHTS.principleStrength +
      TRIZ_SOLUTION_RANKING_WEIGHTS.contextMatch +
      TRIZ_SOLUTION_RANKING_WEIGHTS.executability
    assert.closeTo(weightSum, 1, 0.0001)
  })

  test('限额默认值不可上调，只允许收紧', ({ assert }) => {
    const raised = resolveTrizSolutionLimits({
      maxActionPoints: 99,
      maxActionChars: 9_999,
      maxTitleChars: 9_999,
    })
    assert.equal(raised.maxActionPoints, TRIZ_SOLUTION_LIMITS.maxActionPoints)
    assert.equal(raised.maxActionChars, TRIZ_SOLUTION_LIMITS.maxActionChars)
    assert.equal(raised.maxTitleChars, TRIZ_SOLUTION_LIMITS.maxTitleChars)

    const tightened = resolveTrizSolutionLimits({ maxActionPoints: 1, maxTitleChars: 20 })
    assert.equal(tightened.maxActionPoints, 1)
    assert.equal(tightened.maxTitleChars, 20)

    const floored = resolveTrizSolutionLimits({ maxActionPoints: 0, maxTitleChars: 1 })
    assert.isAtLeast(floored.maxActionPoints, 1, '动作要点不能被压到 0 条')
    assert.isAtLeast(floored.maxTitleChars, 16)
  })
})

// ---------------------------------------------------------------------------
// 补足与降级
// ---------------------------------------------------------------------------

test.group('TRIZ 方案草案 · 补足与降级', () => {
  test('候选不足 3 条时按知识包确定性补足到 3 条（补足条目带标记）', ({ assert }) => {
    const mapping = makeMapping({
      candidatePrinciples: candidatesOf([10, 28]),
      sourceMappingIds: [],
    })
    const set = build(mapping)

    assert.lengthOf(set.solutions, TRIZ_SOLUTION_TOP_COUNT)
    assert.include(set.qualityFlags, 'CANDIDATES_TOPPED_UP')
    assert.notInclude(set.qualityFlags, 'SOLUTION_COUNT_UNDER_LIMIT')

    const toppedUp = set.solutions.filter((solution) => solution.toppedUp)
    assert.lengthOf(toppedUp, 1)
    // 补足条目来自知识包中与本次参数对（#25 × #27）相关的 PM-01 映射，且原理由知识包给出
    assert.equal(toppedUp[0].principle.number, 24)
    assert.isNotNull(searchPrincipleByNumber(24))
    assert.equal(toppedUp[0].ranking.principleStrength, 0.2)
    for (const solution of set.solutions) {
      assert.isTrue(solution.principle.number >= 1 && solution.principle.number <= 40)
    }
  })

  test('知识包无法确定性补足时如实少于 3 条（不编造无关原则）', ({ assert }) => {
    const mapping = makeMapping({
      candidatePrinciples: candidatesOf([10]),
      sourceMappingIds: [],
      improvingParameter: null,
      worseningParameter: null,
    })
    const set = build(mapping)

    assert.lengthOf(set.solutions, 1)
    assert.include(set.qualityFlags, 'SOLUTION_COUNT_UNDER_LIMIT')
    assert.notInclude(set.qualityFlags, 'CANDIDATES_TOPPED_UP')
    assert.equal(set.solutions[0].principle.number, 10)
  })

  test('映射无候选原则且知识包无可补足相关性（信息不足）时零方案并显式标记', ({ assert }) => {
    const set = build(
      makeMapping({
        candidatePrinciples: [],
        sourceMappingIds: [],
        improvingParameter: null,
        worseningParameter: null,
      }),
    )

    assert.lengthOf(set.solutions, 0)
    assert.isTrue(set.insufficientMapping)
    assert.include(set.qualityFlags, 'INSUFFICIENT_MAPPING')
    assert.equal(set.entityBinding, 'none')
    assert.lengthOf(set.excludedPrincipleNumbers, 0)
    assert.isFalse(set.persisted)
    assert.isTrue(set.requiresHumanConfirmation)
  })

  test('映射零候选但参数对可解析时仍按知识包补足（统一策略：能补则补）', ({ assert }) => {
    const set = build(makeMapping({ candidatePrinciples: [], sourceMappingIds: [] }))

    assert.lengthOf(set.solutions, TRIZ_SOLUTION_TOP_COUNT)
    assert.isFalse(set.insufficientMapping)
    assert.notInclude(set.qualityFlags, 'INSUFFICIENT_MAPPING')
    assert.include(set.qualityFlags, 'CANDIDATES_TOPPED_UP')
    for (const solution of set.solutions) {
      assert.isTrue(solution.toppedUp)
      assert.isNotNull(searchPrincipleByNumber(solution.principle.number))
    }
  })
})

// ---------------------------------------------------------------------------
// 实体绑定（反幻觉）
// ---------------------------------------------------------------------------

test.group('TRIZ 方案草案 · 实体绑定与反幻觉', () => {
  test('每条方案至少绑定 1 个白名单实体，动作要点文本带落地对象', ({ assert }) => {
    const pack = makePack()
    const set = build(makeMapping(), pack)

    assert.equal(set.entityBinding, 'bound')
    assert.notInclude(set.qualityFlags, 'GENERIC_ADVICE_NO_ENTITY')
    for (const solution of set.solutions) {
      assert.equal(solution.entityBinding, 'bound')
      assert.isAtLeast(solution.entityRefs.length, 1)
      for (const ref of solution.entityRefs) {
        assert.isTrue(isContextRefWhitelisted(pack, ref), `${ref} 未通过白名单`)
      }
      assert.isAtLeast(solution.actionPoints.length, 1)
      for (const point of solution.actionPoints) {
        assert.isAtLeast(point.entityRefs.length, 1)
        for (const ref of point.entityRefs) {
          assert.isTrue(isContextRefWhitelisted(pack, ref))
        }
        assert.include(point.text, '（对象：')
      }
    }
    // 不同方案落在不同实体上（按事实强度轮转），避免三条方案指向同一个对象
    assert.isAtLeast(new Set(set.solutions.flatMap((entry) => entry.entityRefs)).size, 3)
  })

  test('编造实体引用被剔除并只记计数（不出现在草案任何位置）', ({ assert }) => {
    const pack = makePack()
    const set = build(
      makeMapping({ contextRefs: ['task:1', 'task:999', 'risk:7', 'bogus:1'] }),
      pack,
    )

    assert.include(set.qualityFlags, 'CONTEXT_REFS_REJECTED')
    assert.equal(set.contextRefValidation.rejected, 3)
    assert.isAtLeast(set.contextRefValidation.accepted, 1)
    const serialized = JSON.stringify(set)
    assert.notInclude(serialized, 'task:999')
    assert.notInclude(serialized, 'risk:7')
    assert.notInclude(serialized, 'bogus:1')
    for (const solution of set.solutions) {
      for (const ref of solution.entityRefs) {
        assert.isTrue(isContextRefWhitelisted(pack, ref))
      }
    }
  })

  test('上下文无可用实体时降级为通用建议并显式标注', ({ assert }) => {
    const set = build(makeMapping(), makeEmptyPack())

    assert.lengthOf(set.solutions, TRIZ_SOLUTION_TOP_COUNT)
    assert.equal(set.entityBinding, 'none')
    assert.include(set.qualityFlags, 'GENERIC_ADVICE_NO_ENTITY')
    for (const solution of set.solutions) {
      assert.equal(solution.entityBinding, 'none')
      assert.lengthOf(solution.entityRefs, 0)
      assert.isAbove(solution.actionPoints.length, 0, '通用建议仍须给出可执行动作')
      for (const point of solution.actionPoints) {
        assert.lengthOf(point.entityRefs, 0)
        assert.notInclude(point.text, '（对象：')
      }
      assert.include(solution.title, '通用建议')
      assert.equal(solution.ranking.contextMatch, 0)
    }
  })
})

// ---------------------------------------------------------------------------
// 原则溯源与文案
// ---------------------------------------------------------------------------

test.group('TRIZ 方案草案 · 原则溯源与文案', () => {
  test('来源原则编号与名称一律回填知识包（不采信输入草案的名称字段）', ({ assert }) => {
    const forged = candidatesOf([10, 28, 24]).map((candidate) => ({
      ...candidate,
      nameZh: '伪造中文名',
      displayName: '伪造呈现名',
      definition: '伪造定义',
      source: 'fabricated-source.md',
    }))
    const set = build(makeMapping({ candidatePrinciples: forged }))

    const serialized = JSON.stringify(set)
    assert.notInclude(serialized, '伪造中文名')
    assert.notInclude(serialized, '伪造呈现名')
    assert.notInclude(serialized, '伪造定义')
    assert.notInclude(serialized, 'fabricated-source.md')

    for (const solution of set.solutions) {
      const entry = searchPrincipleByNumber(solution.principle.number)
      assert.isNotNull(entry)
      assert.equal(solution.principle.nameZh, entry!.nameZh)
      assert.equal(solution.principle.displayName, entry!.displayName)
      assert.equal(solution.principle.definition, entry!.definition)
      assert.equal(solution.principle.softwareExamples, entry!.softwareExamples)
      assert.equal(solution.principle.pmInterpretation, entry!.pmInterpretation)
      assert.include(solution.principle.source, 'triz-')
    }
  })

  test('标题为中文大白话：只用现代语汇呈现名，不堆砌古典术语', ({ assert }) => {
    const mapping = makeMapping()
    const set = build(mapping)

    for (const solution of set.solutions) {
      const entry = searchPrincipleByNumber(solution.principle.number)!
      assert.include(solution.title, entry.displayName)
      if (!entry.displayName.includes(entry.nameZh)) {
        assert.notInclude(solution.title, entry.nameZh, `标题不应出现古典术语「${entry.nameZh}」`)
      }
      for (const parameter of [mapping.improvingParameter, mapping.worseningParameter]) {
        if (!parameter) continue
        assert.include(solution.title, parameter.displayName)
        if (!parameter.displayName.includes(parameter.nameZh)) {
          assert.notInclude(solution.title, parameter.nameZh)
        }
      }
      assert.isAtMost(Array.from(solution.title).length, TRIZ_SOLUTION_LIMITS.maxTitleChars)
    }
  })

  test('每条方案给出影响提示与前置条件，且展开解释字段齐全', ({ assert }) => {
    const set = build(makeMapping())

    for (const solution of set.solutions) {
      assert.isAbove(solution.impact.positive.length, 0)
      assert.isAbove(solution.impact.negative.length, 0)
      assert.isAtLeast(solution.preconditions.length, 1)
      assert.isAtMost(solution.preconditions.length, TRIZ_SOLUTION_LIMITS.maxPreconditions)
      assert.include(solution.preconditions[0], '人工确认')

      // spec 第 2 条：可展开查看被引用原则的定义、软件/管理实例与 PM 场景释义
      assert.isAbove(solution.principle.definition.length, 0)
      assert.isAbove(solution.principle.softwareExamples.length, 0)
      assert.isAbove(solution.principle.pmInterpretation.length, 0)
      assert.isAbove(solution.principle.nameEn.length, 0)
    }
  })
})

// ---------------------------------------------------------------------------
// 只产草案 / 低敏 / 零模型调用
// ---------------------------------------------------------------------------

test.group('TRIZ 方案草案 · 只产草案与低敏边界', () => {
  test('服务原型只暴露 build 一个公开方法（无落库 / 确认通道）', ({ assert }) => {
    assert.deepEqual(Object.getOwnPropertyNames(TrizSolutionDraftService.prototype).sort(), [
      'build',
      'constructor',
    ])
  })

  test('模块内无数据访问与写入特征（含特征表自检防空转）', ({ assert }) => {
    const probes: ReadonlyArray<string> = [
      "import Task from '#models/task'",
      'await Task.query()',
      'await row.save()',
      "await db.from('tasks').update({ status: 'done' })",
    ]
    for (const probe of probes) {
      assert.isTrue(
        WRITE_PATTERNS.some(([pattern]) => pattern.test(probe)),
        `特征表未命中探针样本：${probe}`,
      )
    }

    const source = readSource(SERVICE_RELATIVE_PATH)
    assert.isAbove(source.length, 4_000, '源文件读取异常，静态断言可能空转')
    for (const [pattern, label] of WRITE_PATTERNS) {
      assert.isFalse(pattern.test(source), `命中数据访问 / 写入特征：${label}`)
    }
  })

  test('模块内无模型通道依赖（纯确定性组装，零真实调用）', ({ assert }) => {
    const probes: ReadonlyArray<string> = [
      "import { resolveAdapter } from '#services/ai_m0/resolver'",
      'const gateway: AIGateway = resolved.gateway',
      'modelUsage.providerCalls += 1',
    ]
    for (const probe of probes) {
      assert.isTrue(
        MODEL_PATTERNS.some(([pattern]) => pattern.test(probe)),
        `特征表未命中探针样本：${probe}`,
      )
    }

    const source = readSource(SERVICE_RELATIVE_PATH)
    for (const [pattern, label] of MODEL_PATTERNS) {
      assert.isFalse(pattern.test(source), `命中模型通道特征：${label}`)
    }
  })

  test('草案显式声明未落库且必须经人工确认，文本为有界摘要', ({ assert }) => {
    const set = build(makeMapping({ candidatePrinciples: candidatesOf([10, 28, 24, 1, 35, 19]) }))

    assert.isFalse(set.persisted)
    assert.isTrue(set.requiresHumanConfirmation)
    for (const solution of set.solutions) {
      assert.isFalse(solution.persisted)
      assert.isTrue(solution.requiresHumanConfirmation)
      assert.isAtMost(Array.from(solution.title).length, TRIZ_SOLUTION_LIMITS.maxTitleChars)
      for (const point of solution.actionPoints) {
        assert.isAtMost(Array.from(point.text).length, TRIZ_SOLUTION_LIMITS.maxActionChars)
      }
      assert.isAtMost(
        Array.from(solution.impact.positive).length,
        TRIZ_SOLUTION_LIMITS.maxImpactChars,
      )
      assert.isAtMost(
        Array.from(solution.impact.negative).length,
        TRIZ_SOLUTION_LIMITS.maxImpactChars,
      )
    }

    const serialized = JSON.stringify(set)
    assert.notInclude(serialized, 'prompt')
    assert.notInclude(serialized, 'rawText')
  })

  test('落库投影字段表冻结：只有序号 / 编号 / 有界标题 / 引用 / 分数', ({ assert }) => {
    const set = build(makeMapping())
    const record = toTrizSolutionLowSensitivityRecord(set)

    assert.deepEqual(Object.keys(record).sort(), [
      'contextRefValidation',
      'entityBinding',
      'excludedPrincipleNumbers',
      'knowledgePackVersion',
      'path',
      'qualityFlags',
      'solutions',
    ])
    assert.equal(record.path, set.path)
    assert.lengthOf(record.solutions, 3)
    for (const entry of record.solutions) {
      assert.deepEqual(Object.keys(entry).sort(), [
        'entityRefs',
        'index',
        'principleNumber',
        'score',
        'title',
      ])
      assert.isAtMost(Array.from(entry.title).length, TRIZ_SOLUTION_LIMITS.maxTitleChars)
      for (const ref of entry.entityRefs) {
        assert.isTrue(isContextRefWhitelisted(makePack(), ref))
      }
    }

    // 冻结清单之外的字段一律不进入投影（防未来字段悄悄落库）
    for (const flag of TRIZ_SOLUTION_QUALITY_FLAGS) {
      assert.isTrue(typeof flag === 'string' && flag.length > 0)
    }
  })
})
