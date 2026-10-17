// v3-triz-contradiction-copilot tasks 1.6 —— 确定性回退路径加固单测。
//
// 覆盖（tasks 1.6 验收 + spec「确定性回退与路径诚实披露」第 1–5 条 + design D6、
// 「测试策略」③ 的空转护栏要求）：
// - **触发矩阵完整披露**：七类触发（真实模型未启用 / 预算阻断 / 无 ai:trigger / 通道不可用 /
//   模型失败 / 模型超时 / 输出非法）逐条断言 `path: 'rule'`、`providerCalls` 口径与机器可读原因码，
//   并断言回退产出与纯规则路径草案完全一致（确定性回退不是「再猜一次」）；
// - **Schema 一致性**：规则路径与模型路径的映射草案、1.5 的方案草案字段集逐键一致
//   （同一 zod schema 解析两侧通过；允许值不同、不允许键不同；schema 带负向探针防自证空转）；
// - **零 Token**：未发出任何模型调用时 `totalTokens` 精确为 0；已发出调用时如实披露供应商回报值、
//   未回报时为 null（未知不等于零消耗，不得伪报为 0）；
// - **加固点**：已发出调用的失败不再静默丢弃供应商用量；预算门不可用时 fail-closed 回退。
import { test } from '@japa/runner'
import { z } from 'zod'

import { AI_TRIGGER } from '#rbac'
import {
  TRIZ_CONTEXT_PACK_LIMITS,
  type TrizContextPack,
} from '#services/triz_copilot/triz_context_pack_service'
import TrizContradictionMappingService, {
  TRIZ_MAPPING_FALLBACK_REASONS,
  TRIZ_MAPPING_LIMITS,
  TRIZ_MAPPING_QUALITY_FLAGS,
  buildTrizRulePathDraft,
  type TrizContradictionMappingDraft,
  type TrizContradictionMappingRequest,
  type TrizContradictionMappingResult,
  type TrizMappingActor,
  type TrizMappingFallbackReason,
  type TrizMappingGenerationRequest,
  type TrizMappingGenerationResponse,
  type TrizMappingModelPort,
} from '#services/triz_copilot/triz_contradiction_mapping_service'
import TrizSolutionDraftService, {
  TRIZ_SOLUTION_QUALITY_FLAGS,
  type TrizSolutionDraftSet,
} from '#services/triz_copilot/triz_solution_draft_service'
import type { TrizContextPermissionChecker } from '#services/triz_copilot/triz_context_pack_service'

// ---------------------------------------------------------------------------
// fixture：上下文包 / 权限端口 / 模型端口 / 请求
// ---------------------------------------------------------------------------

const ORG_ID = 11
const PROJECT_ID = 22
const ACTOR = { id: 7 } as unknown as TrizMappingActor

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
        ],
        criticalPathTaskIds: [1, 2],
        truncated: false,
      },
      risks: {
        readings: { total: 1, matrixCells: [{ probability: 3, impact: 4, count: 1 }] },
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

function allowAll(): TrizContextPermissionChecker {
  return { check: async () => ({ allowed: true }) }
}

function denyTrigger(): TrizContextPermissionChecker {
  return {
    check: async (_user, permission) => ({
      allowed: permission !== AI_TRIGGER,
      reason: permission === AI_TRIGGER ? 'missing_permission' : undefined,
    }),
  }
}

interface FakeModelPort {
  port: TrizMappingModelPort
  calls: TrizMappingGenerationRequest[]
}

function makeModelPort(
  handler: (request: TrizMappingGenerationRequest) => Promise<TrizMappingGenerationResponse>,
): FakeModelPort {
  const calls: TrizMappingGenerationRequest[] = []
  return {
    calls,
    port: {
      async generate(request) {
        calls.push(request)
        return handler(request)
      },
    },
  }
}

function modelResponse(
  rawText: string,
  overrides: Partial<TrizMappingGenerationResponse> = {},
): TrizMappingGenerationResponse {
  return {
    rawText,
    provider: 'fixture-provider',
    model: 'fixture-model',
    totalTokens: 128,
    usingRealAdapter: true,
    ...overrides,
  }
}

function modelOutputJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    contradictionType: 'technical',
    improvingParameterNumber: 39,
    worseningParameterNumber: 27,
    candidatePrinciples: [35, 10, 28],
    confidence: 0.72,
    contextRefs: ['task:1'],
    ...overrides,
  })
}

function makeRequest(
  statement: string,
  overrides: Partial<TrizContradictionMappingRequest> = {},
): TrizContradictionMappingRequest {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    actor: ACTOR,
    contextPack: makePack(),
    statement,
    ...overrides,
  }
}

/** 命中 14 对 PM 矛盾映射之一的陈述（规则路径必然产出可用草案）。 */
const SPEC_STATEMENT = '客户要求赶工期提前交付，但代码质量不能降低'

// ---------------------------------------------------------------------------
// 触发矩阵：七类触发逐条披露
// ---------------------------------------------------------------------------

interface TriggerCase {
  reason: TrizMappingFallbackReason
  label: string
  expectedProviderCalls: 0 | 1
  /** 零 Token 口径：0 = 未发出任何调用（精确为 0）；null = 已发出调用且用量未知 */
  expectedTotalTokens: number | null
  request?: Partial<TrizContradictionMappingRequest>
  setup: () => { service: TrizContradictionMappingService; calls: TrizMappingGenerationRequest[] }
}

const TRIGGER_MATRIX: readonly TriggerCase[] = [
  {
    reason: 'MODEL_DISABLED',
    label: '真实模型未启用（默认状态）',
    expectedProviderCalls: 0,
    expectedTotalTokens: 0,
    setup: () => {
      const model = makeModelPort(async () => {
        throw new Error('真实模型已关闭，模型通道不应被调用')
      })
      return {
        calls: model.calls,
        service: new TrizContradictionMappingService({
          permissionChecker: allowAll(),
          model: model.port,
          realAiEnabled: false,
        }),
      }
    },
  },
  {
    reason: 'NO_AI_TRIGGER',
    label: '调用方无 ai:trigger 权限',
    expectedProviderCalls: 0,
    expectedTotalTokens: 0,
    setup: () => {
      const model = makeModelPort(async () => {
        throw new Error('无 ai:trigger 时模型通道不应被调用')
      })
      return {
        calls: model.calls,
        service: new TrizContradictionMappingService({
          permissionChecker: denyTrigger(),
          model: model.port,
          realAiEnabled: true,
        }),
      }
    },
  },
  {
    reason: 'BUDGET_EXHAUSTED',
    label: '单次分析 Token 预算阻断',
    expectedProviderCalls: 0,
    expectedTotalTokens: 0,
    request: { limits: { runTokenBudget: 256 } },
    setup: () => {
      const model = makeModelPort(async () => {
        throw new Error('预算阻断时模型通道不应被调用')
      })
      return {
        calls: model.calls,
        service: new TrizContradictionMappingService({
          permissionChecker: allowAll(),
          model: model.port,
          realAiEnabled: true,
        }),
      }
    },
  },
  {
    reason: 'MODEL_UNAVAILABLE',
    label: '模型通道不可用（未解析到真实适配器）',
    expectedProviderCalls: 0,
    expectedTotalTokens: 0,
    setup: () => ({
      calls: [],
      service: new TrizContradictionMappingService({
        permissionChecker: allowAll(),
        model: null,
        realAiEnabled: true,
      }),
    }),
  },
  {
    reason: 'MODEL_FAILED',
    label: '模型调用失败',
    expectedProviderCalls: 1,
    expectedTotalTokens: null,
    setup: () => {
      const model = makeModelPort(async () => {
        throw new Error('provider 抖动')
      })
      return {
        calls: model.calls,
        service: new TrizContradictionMappingService({
          permissionChecker: allowAll(),
          model: model.port,
          realAiEnabled: true,
        }),
      }
    },
  },
  {
    reason: 'MODEL_TIMEOUT',
    label: '模型调用超时',
    expectedProviderCalls: 1,
    expectedTotalTokens: null,
    request: { limits: { requestTimeoutMs: 20 } },
    setup: () => {
      const model = makeModelPort(
        (request) =>
          new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            })
          }),
      )
      return {
        calls: model.calls,
        service: new TrizContradictionMappingService({
          permissionChecker: allowAll(),
          model: model.port,
          realAiEnabled: true,
        }),
      }
    },
  },
  {
    reason: 'MODEL_OUTPUT_INVALID',
    label: '模型输出未过强 Schema',
    expectedProviderCalls: 1,
    expectedTotalTokens: 0,
    setup: () => {
      const model = makeModelPort(async () =>
        modelResponse('模型说这不是 JSON，但结论是 #39 × #27', { totalTokens: 0 }),
      )
      return {
        calls: model.calls,
        service: new TrizContradictionMappingService({
          permissionChecker: allowAll(),
          model: model.port,
          realAiEnabled: true,
        }),
      }
    },
  },
]

test.group('TRIZ 确定性回退 · 触发矩阵披露', () => {
  test('七类触发逐条落到规则路径并披露机器可读原因码', async ({ assert }) => {
    assert.lengthOf(TRIGGER_MATRIX, 7)

    for (const trigger of TRIGGER_MATRIX) {
      const { service, calls } = trigger.setup()
      const result = await service.map(makeRequest(SPEC_STATEMENT, trigger.request ?? {}))

      assert.equal(result.mapping.path, 'rule', `${trigger.label} 应落规则路径`)
      assert.deepEqual(
        result.mapping.fallbackReasons,
        [trigger.reason],
        `${trigger.label} 的原因码披露不符（且不应叠加无关原因）`,
      )
      assert.equal(
        result.modelUsage.providerCalls,
        trigger.expectedProviderCalls,
        `${trigger.label} 的 provider 调用计数不符`,
      )
      assert.lengthOf(calls, trigger.expectedProviderCalls, `${trigger.label} 的通道调用次数不符`)
      assert.equal(result.lowSensitivityRecord.path, 'rule')
      assert.isFalse(result.mapping.persisted)
      assert.isTrue(result.mapping.requiresHumanConfirmation)

      // 回退产出必须与纯规则路径草案完全一致：确定性回退，不是「再猜一次」
      const expected = buildTrizRulePathDraft({
        statement: SPEC_STATEMENT,
        pack: makePack(),
        statementTruncated: false,
        fallbackReasons: [trigger.reason],
        limits: TRIZ_MAPPING_LIMITS,
      })
      assert.deepEqual(result.mapping, expected, `${trigger.label} 的规则草案存在偏差`)
      assert.isAbove(result.mapping.candidatePrinciples.length, 0)
      assert.isAbove(result.mapping.contextRefs.length, 0)
    }
  })

  test('原因码闭集完整且每类都能被触发（无不可达原因码）', async ({ assert }) => {
    const observed: string[] = []
    for (const trigger of TRIGGER_MATRIX) {
      const { service } = trigger.setup()
      const result = await service.map(makeRequest(SPEC_STATEMENT, trigger.request ?? {}))
      for (const reason of result.mapping.fallbackReasons) {
        if (!observed.includes(reason)) observed.push(reason)
      }
    }

    assert.deepEqual([...observed].sort(), [...TRIZ_MAPPING_FALLBACK_REASONS].sort())
  })

  test('回退结果仍可走通到方案草案（同一确认落库链路对用户不消失）', async ({ assert }) => {
    const { service } = TRIGGER_MATRIX[0].setup()
    const result = await service.map(makeRequest(SPEC_STATEMENT))
    const set = new TrizSolutionDraftService().build({
      mapping: result.mapping,
      contextPack: makePack(),
    })

    assert.lengthOf(set.solutions, 3)
    assert.equal(set.path, 'rule')
    assert.equal(set.entityBinding, 'bound')
    assert.isFalse(set.persisted)
    assert.isTrue(set.requiresHumanConfirmation)
  })
})

// ---------------------------------------------------------------------------
// 零 Token 口径
// ---------------------------------------------------------------------------

test.group('TRIZ 确定性回退 · 零 Token', () => {
  test('未发出任何模型调用时 totalTokens 精确为 0（确定性回退零 Token 可直接断言）', async ({
    assert,
  }) => {
    const noCallCases = TRIGGER_MATRIX.filter((trigger) => trigger.expectedProviderCalls === 0)
    assert.lengthOf(noCallCases, 4)

    for (const trigger of noCallCases) {
      const { service } = trigger.setup()
      const result = await service.map(makeRequest(SPEC_STATEMENT, trigger.request ?? {}))
      assert.equal(
        result.modelUsage.totalTokens,
        0,
        `${trigger.label} 未发出调用，用量必须精确为 0`,
      )
    }
  })

  test('已发出调用的失败不伪报为零消耗（未知保持 null，已知则如实披露）', async ({ assert }) => {
    const attempted = TRIGGER_MATRIX.filter((trigger) => trigger.expectedProviderCalls === 1)
    assert.lengthOf(attempted, 3)

    for (const trigger of attempted) {
      const { service } = trigger.setup()
      const result = await service.map(makeRequest(SPEC_STATEMENT, trigger.request ?? {}))
      if (trigger.expectedTotalTokens === null) {
        assert.isNull(
          result.modelUsage.totalTokens,
          `${trigger.label} 的供应商用量未知，不得伪报为 0`,
        )
      } else {
        assert.equal(result.modelUsage.totalTokens, trigger.expectedTotalTokens)
      }
    }
  })

  test('零 Token 口径与规则路径产出解耦：用量字段不影响草案内容', async ({ assert }) => {
    const { service } = TRIGGER_MATRIX[0].setup()
    const first = await service.map(makeRequest(SPEC_STATEMENT))
    const second = await service.map(makeRequest(SPEC_STATEMENT))
    assert.deepEqual(first.mapping, second.mapping)
    assert.deepEqual(first.modelUsage, second.modelUsage)
    assert.equal(second.modelUsage.totalTokens, 0)
  })
})

// ---------------------------------------------------------------------------
// Schema 一致性（规则路径 ↔ 模型路径）
// ---------------------------------------------------------------------------

const parameterRefSchema = z.strictObject({
  number: z.number().int().min(1).max(39),
  nameZh: z.string().min(1),
  displayName: z.string().min(1),
  pmMeaning: z.string().min(1),
})

const candidatePrincipleRefSchema = z.strictObject({
  rank: z.number().int().min(1),
  number: z.number().int().min(1).max(40),
  nameZh: z.string().min(1),
  displayName: z.string().min(1),
  definition: z.string().min(1),
  source: z.string().min(1),
})

/**
 * 映射草案的「同 Schema」契约：类型注解把 schema 与生产类型**编译期绑定**
 * （任一侧增删键都会编译报错），运行期用 strictObject 拒绝多余键。
 */
const mappingDraftSchema: z.ZodType<TrizContradictionMappingDraft> = z.strictObject({
  path: z.enum(['ai', 'rule']),
  contradictionType: z.enum(['administrative', 'technical', 'physical']),
  contradictionTypeLabel: z.string().min(1),
  improvingParameter: parameterRefSchema.nullable(),
  worseningParameter: parameterRefSchema.nullable(),
  candidatePrinciples: z.array(candidatePrincipleRefSchema),
  confidence: z.number().min(0).max(1),
  contextRefs: z.array(z.string().regex(/^(task|risk|resource|milestone|change_request):\d+$/)),
  contextRefValidation: z.strictObject({
    accepted: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
  sourceMappingIds: z.array(z.string()),
  sourceSections: z.array(z.string()),
  requiresHumanConfirmation: z.literal(true),
  persisted: z.literal(false),
  needsClarification: z.boolean(),
  fallbackReasons: z.array(z.enum(TRIZ_MAPPING_FALLBACK_REASONS)),
  qualityFlags: z.array(z.enum(TRIZ_MAPPING_QUALITY_FLAGS)),
  statementDigest: z.string().regex(/^[0-9a-f]{32}$/),
  statementLength: z.number().int().min(0),
  statementTruncated: z.boolean(),
  knowledgePackVersion: z.string().min(1),
})

const solutionDraftSchema = z.strictObject({
  index: z.number().int().min(1),
  title: z.string().min(1),
  principle: z.strictObject({
    number: z.number().int().min(1).max(40),
    nameZh: z.string().min(1),
    nameEn: z.string().min(1),
    displayName: z.string().min(1),
    definition: z.string().min(1),
    softwareExamples: z.string().min(1),
    pmInterpretation: z.string().min(1),
    source: z.string().min(1),
  }),
  actionPoints: z.array(
    z.strictObject({ text: z.string().min(1), entityRefs: z.array(z.string()) }),
  ),
  impact: z.strictObject({ positive: z.string().min(1), negative: z.string().min(1) }),
  preconditions: z.array(z.string().min(1)),
  entityRefs: z.array(z.string()),
  entityBinding: z.enum(['bound', 'none']),
  ranking: z.strictObject({
    principleStrength: z.number().min(0).max(1),
    contextMatch: z.number().min(0).max(1),
    executability: z.number().min(0).max(1),
    score: z.number().min(0).max(1),
  }),
  toppedUp: z.boolean(),
  requiresHumanConfirmation: z.literal(true),
  persisted: z.literal(false),
})

const solutionSetSchema: z.ZodType<TrizSolutionDraftSet> = z.strictObject({
  solutions: z.array(solutionDraftSchema),
  entityBinding: z.enum(['bound', 'partial', 'none']),
  candidatePrincipleNumbers: z.array(z.number().int()),
  excludedPrincipleNumbers: z.array(z.number().int()),
  path: z.enum(['ai', 'rule']),
  contradictionType: z.enum(['administrative', 'technical', 'physical']),
  sourceMappingIds: z.array(z.string()),
  contextRefValidation: z.strictObject({
    accepted: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
  qualityFlags: z.array(z.enum(TRIZ_SOLUTION_QUALITY_FLAGS)),
  insufficientMapping: z.boolean(),
  knowledgePackVersion: z.string().min(1),
  requiresHumanConfirmation: z.literal(true),
  persisted: z.literal(false),
})

async function mapBothPaths(): Promise<{
  rule: TrizContradictionMappingResult
  ai: TrizContradictionMappingResult
}> {
  const rule = await new TrizContradictionMappingService({
    permissionChecker: allowAll(),
    model: null,
    realAiEnabled: false,
  }).map(makeRequest(SPEC_STATEMENT))

  const model = makeModelPort(async () => modelResponse(modelOutputJson()))
  const ai = await new TrizContradictionMappingService({
    permissionChecker: allowAll(),
    model: model.port,
    realAiEnabled: true,
  }).map(makeRequest(SPEC_STATEMENT))

  return { rule, ai }
}

function withoutKey(value: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value }
  delete copy[key]
  return copy
}

test.group('TRIZ 确定性回退 · Schema 一致性', () => {
  test('映射草案：两条路径同一 zod schema 解析通过且逐键一致', async ({ assert }) => {
    const { rule, ai } = await mapBothPaths()

    assert.equal(rule.mapping.path, 'rule')
    assert.equal(ai.mapping.path, 'ai')

    const ruleParsed = mappingDraftSchema.safeParse(rule.mapping)
    const aiParsed = mappingDraftSchema.safeParse(ai.mapping)
    assert.isTrue(ruleParsed.success, JSON.stringify(ruleParsed.error?.issues ?? []))
    assert.isTrue(aiParsed.success, JSON.stringify(aiParsed.error?.issues ?? []))

    assert.deepEqual(Object.keys(rule.mapping).sort(), Object.keys(ai.mapping).sort())
    assert.deepEqual(
      Object.keys(rule.lowSensitivityRecord).sort(),
      Object.keys(ai.lowSensitivityRecord).sort(),
    )
    // 允许值不同：路径、来源映射与回退原因就是两条路径的差异所在
    assert.notDeepEqual(rule.mapping.fallbackReasons, ai.mapping.fallbackReasons)
    assert.deepEqual(ai.mapping.fallbackReasons, [])
  })

  test('Schema 契约非空转：多余键与缺失键都被拒绝', async ({ assert }) => {
    const { rule } = await mapBothPaths()

    assert.isTrue(mappingDraftSchema.safeParse(rule.mapping).success)
    assert.isFalse(
      mappingDraftSchema.safeParse({ ...rule.mapping, shadowKey: 1 }).success,
      'schema 必须拒绝多余键',
    )
    assert.isFalse(
      mappingDraftSchema.safeParse(withoutKey(rule.mapping, 'confidence')).success,
      'schema 必须要求必需键',
    )
    assert.isFalse(
      mappingDraftSchema.safeParse({ ...rule.mapping, persisted: true }).success,
      'persisted 只允许 false（只产草案）',
    )
  })

  test('方案草案：两条路径同一 zod schema 解析通过且逐键一致', async ({ assert }) => {
    const { rule, ai } = await mapBothPaths()
    const service = new TrizSolutionDraftService()
    const ruleSet = service.build({ mapping: rule.mapping, contextPack: makePack() })
    const aiSet = service.build({ mapping: ai.mapping, contextPack: makePack() })

    const ruleParsed = solutionSetSchema.safeParse(ruleSet)
    const aiParsed = solutionSetSchema.safeParse(aiSet)
    assert.isTrue(ruleParsed.success, JSON.stringify(ruleParsed.error?.issues ?? []))
    assert.isTrue(aiParsed.success, JSON.stringify(aiParsed.error?.issues ?? []))

    assert.deepEqual(Object.keys(ruleSet).sort(), Object.keys(aiSet).sort())
    assert.deepEqual(
      ruleSet.solutions.map((solution) => Object.keys(solution).sort()),
      aiSet.solutions.map((solution) => Object.keys(solution).sort()),
    )
    assert.lengthOf(ruleSet.solutions, 3)
    assert.lengthOf(aiSet.solutions, 3)
    assert.equal(ruleSet.path, 'rule')
    assert.equal(aiSet.path, 'ai')

    assert.isFalse(solutionSetSchema.safeParse({ ...ruleSet, shadowKey: 1 }).success)
    assert.isFalse(solutionSetSchema.safeParse(withoutKey(ruleSet, 'solutions')).success)
  })
})

// ---------------------------------------------------------------------------
// 加固点（1.6 对 1.4 既有实现的三处小改）
// ---------------------------------------------------------------------------

test.group('TRIZ 确定性回退 · 加固点', () => {
  test('已发出调用的失败如实披露供应商用量（不再静默丢弃）', async ({ assert }) => {
    const model = makeModelPort(async () => modelResponse('不是 JSON 的自由文本'))
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'rule')
    assert.deepEqual(result.mapping.fallbackReasons, ['MODEL_OUTPUT_INVALID'])
    assert.equal(result.modelUsage.providerCalls, 1)
    assert.equal(result.modelUsage.provider, 'fixture-provider')
    assert.equal(result.modelUsage.model, 'fixture-model')
    assert.equal(result.modelUsage.totalTokens, 128, '供应商回报的用量必须如实披露')
    assert.notInclude(JSON.stringify(result), '不是 JSON 的自由文本')
  })

  test('预算门实现抛错时按预算阻断回退（fail-closed，不抛未处理异常）', async ({ assert }) => {
    const model = makeModelPort(async () => {
      throw new Error('预算门异常时模型通道不应被调用')
    })
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
      budgetGate: {
        preflight: async () => {
          throw new Error('预算账本不可用')
        },
      },
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'rule')
    assert.deepEqual(result.mapping.fallbackReasons, ['BUDGET_EXHAUSTED'])
    assert.equal(result.modelUsage.providerCalls, 0)
    assert.equal(result.modelUsage.totalTokens, 0)
    assert.lengthOf(model.calls, 0)
  })

  test('模型路径成功时用量语义不变（加固未改变既有行为）', async ({ assert }) => {
    const model = makeModelPort(async () => modelResponse(modelOutputJson()))
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'ai')
    assert.deepEqual(result.mapping.fallbackReasons, [])
    assert.equal(result.modelUsage.providerCalls, 1)
    assert.equal(result.modelUsage.totalTokens, 128)
    assert.equal(result.modelUsage.provider, 'fixture-provider')
    assert.equal(result.modelUsage.model, 'fixture-model')
  })
})
