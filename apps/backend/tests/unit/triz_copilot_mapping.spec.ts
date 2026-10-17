// v3-triz-contradiction-copilot tasks 1.4 —— AI-as-ARIZ 矛盾语义映射服务单测。
//
// 覆盖（tasks 1.4 验收 + spec「AI-as-ARIZ 后台语义映射」第 1/2 条、「确定性回退与路径诚实披露」、
// 「反幻觉与低敏审计边界」第 1/3 条、design「红线守卫设计」RL-02/RL-03/RL-12/RL-13 行）：
// - 强 Schema：模型输出只能取闭集编号与规范实体引用，多余字段一律拒绝；
// - 反幻觉关卡：contextRefs 逐个过 1.3 白名单，未通过即丢弃并只记计数；参数 / 原则名称取自知识包；
// - 14 对 PM 矛盾样例逐对走通（规则路径），并断言 providerCalls = 0（默认 fixture/mock，零真实调用）；
// - 空输入 / 歧义输入 / 超长输入截断；
// - 七类回退触发（默认关闭、无 ai:trigger、预算阻断、通道不可用、调用失败、超时、输出非法）；
// - 人工确认关卡：本服务只产草案，零业务表写入（静态扫描 + 原型方法表 + 落库投影字段表）；
// - 低敏：落库投影只有编号 / 枚举 / 摘要 / 引用，无 prompt 与模型输出全文（RL-12）。
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ValidationException } from '#exceptions/api_exception'
import { AI_TRIGGER } from '#rbac'
import { TRIZ_PM_CONTRAIDCTION_PAIRS } from '#services/triz_copilot/knowledge/index'
import { searchParameterByNumber } from '#services/triz_copilot/triz_knowledge_search_service'
import {
  TRIZ_CONTEXT_PACK_LIMITS,
  isContextRefWhitelisted,
  type TrizContextPack,
  type TrizContextPermissionChecker,
} from '#services/triz_copilot/triz_context_pack_service'
import TrizContradictionMappingService, {
  TRIZ_MAPPING_CAPABILITY,
  TRIZ_MAPPING_LIMITS,
  createUnifiedBudgetGate,
  buildTrizMappingPrompt,
  buildTrizRulePathDraft,
  digestTrizStatement,
  estimateTrizMappingTokens,
  filterContextRefs,
  filterPrincipleNumbers,
  isDiscriminatingTrizToken,
  isTrizRealAiEnabled,
  parseTrizMappingModelOutput,
  resolveTrizMappingLimits,
  toLowSensitivityRecord,
  trizMappingModelJsonSchema,
  type TrizContradictionMappingRequest,
  type TrizContradictionMappingResult,
  type TrizMappingActor,
  type TrizMappingBudgetDecision,
  type TrizMappingGenerationRequest,
  type TrizMappingGenerationResponse,
  type TrizMappingModelPort,
} from '#services/triz_copilot/triz_contradiction_mapping_service'

const SERVICE_RELATIVE_PATH =
  '../../app/services/triz_copilot/triz_contradiction_mapping_service.ts'

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

/** 权限端口：全部放行 / 按权限拒绝。 */
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

/** 假模型端口：记录调用请求，便于断言「调用次数 = providerCalls」。 */
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

function modelResponse(rawText: string): TrizMappingGenerationResponse {
  return {
    rawText,
    provider: 'fixture-provider',
    model: 'fixture-model',
    totalTokens: 128,
    usingRealAdapter: true,
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

/** 14 对 PM 矛盾映射的大白话样例（PM 视角改写，逐对一条）。 */
const PAIR_STATEMENTS: ReadonlyArray<{ id: string; statement: string }> = [
  { id: 'PM-01', statement: '客户要求赶工期提前交付，但代码质量不能降低' },
  { id: 'PM-02', statement: '需求方要求全功能上线，但预算有限' },
  { id: 'PM-03', statement: '项目要加速，但加人之后沟通成本指数增长' },
  { id: 'PM-04', statement: '客户频繁变更需求，但项目计划需要保持稳定' },
  { id: 'PM-05', statement: '使用新技术带来竞争优势，但增加项目失败风险' },
  { id: 'PM-06', statement: '为了快速交付功能，技术债务越积越多，维护成本飙升' },
  { id: 'PM-07', statement: '提高自动化程度提升了效率，但人工监督和干预能力下降' },
  { id: 'PM-08', statement: '流程标准化提高了效率，但不同客户需要定制化方案' },
  { id: 'PM-09', statement: '集中管理保证一致性，但抑制了团队自主性和创新' },
  { id: 'PM-10', statement: '详细文档有助于知识传承，但写文档拖慢了开发速度' },
  { id: 'PM-11', statement: '严格的安全措施降低了用户体验和使用效率' },
  { id: 'PM-12', statement: '先做快速变现的功能拿到短期收益，再投资长期平台建设' },
  { id: 'PM-13', statement: '丰富的 UI 动效和交互提升了用户体验，但消耗性能资源' },
  { id: 'PM-14', statement: '多团队并行开发提高了速度，但集成时冲突和 Bug 增多' },
]

/** spec 场景 1 的原句（大白话 → 技术矛盾，改善为生产率类、恶化为复杂度类）。 */
const SPEC_STATEMENT = '客户催进度，但再加人测试就跟不上了'

// ---------------------------------------------------------------------------
// 强 Schema
// ---------------------------------------------------------------------------

test.group('TRIZ 矛盾映射 · 强 Schema', () => {
  test('合法输出通过校验（含代码围栏归一）', ({ assert }) => {
    const valid = modelOutputJson()
    const parsed = parseTrizMappingModelOutput(valid)
    assert.isTrue(parsed.ok)
    if (parsed.ok) {
      assert.equal(parsed.value.improvingParameterNumber, 39)
      assert.deepEqual(parsed.value.candidatePrinciples, [35, 10, 28])
    }

    const fenced = parseTrizMappingModelOutput('```json\n' + valid + '\n```')
    assert.isTrue(fenced.ok)
  })

  test('非法输出只回报位置与问题码（不含模型正文）', ({ assert }) => {
    const cases: Array<[string, string]> = [
      ['', '$:empty_output'],
      ['模型说这不是 JSON，但结论是 #39 × #27', '$:not_json'],
      [modelOutputJson({ improvingParameterNumber: 0 }), 'improvingParameterNumber:too_small'],
      [modelOutputJson({ worseningParameterNumber: 40 }), 'worseningParameterNumber:too_big'],
      [modelOutputJson({ candidatePrinciples: [41] }), 'candidatePrinciples.0:too_big'],
      [modelOutputJson({ confidence: 1.5 }), 'confidence:too_big'],
      [modelOutputJson({ contextRefs: ['任务39'] }), 'contextRefs.0:invalid_format'],
      [modelOutputJson({ contradictionType: '仿造类型' }), 'contradictionType:invalid_value'],
      [modelOutputJson({ note: '模型自由文本' }), '$:unrecognized_keys'],
    ]

    for (const [raw, expectedIssue] of cases) {
      const parsed = parseTrizMappingModelOutput(raw)
      assert.isFalse(parsed.ok, `应拒绝：${raw.slice(0, 40)}`)
      if (!parsed.ok) {
        assert.include(parsed.issues, expectedIssue)
        for (const issue of parsed.issues) {
          assert.isBelow(issue.length, 64, '问题码不应夹带模型正文')
        }
      }
    }
  })

  test('下发给供应商的 JSON Schema 为闭集且拒绝多余字段', ({ assert }) => {
    const schema = trizMappingModelJsonSchema() as {
      additionalProperties: boolean
      properties: Record<string, { enum?: string[]; maximum?: number; minimum?: number }>
      required: string[]
    }
    assert.isFalse(schema.additionalProperties)
    assert.deepEqual(schema.properties.contradictionType.enum, [
      'administrative',
      'technical',
      'physical',
    ])
    assert.equal(schema.properties.improvingParameterNumber.minimum, 1)
    assert.equal(schema.properties.improvingParameterNumber.maximum, 39)
    assert.equal(schema.properties.confidence.minimum, 0)
    assert.equal(schema.properties.confidence.maximum, 1)
    assert.deepEqual(schema.required.sort(), [
      'candidatePrinciples',
      'confidence',
      'contextRefs',
      'contradictionType',
      'improvingParameterNumber',
      'worseningParameterNumber',
    ])
  })
})

// ---------------------------------------------------------------------------
// 反幻觉关卡
// ---------------------------------------------------------------------------

test.group('TRIZ 矛盾映射 · 反幻觉关卡', () => {
  test('上下文引用逐个过白名单，编造引用丢弃且只记计数', ({ assert }) => {
    const pack = makePack()
    const result = filterContextRefs(pack, [
      'task:1',
      'task:999',
      'risk:1',
      'risk:7',
      'bogus:1',
      'task:1',
    ])
    assert.deepEqual(result.accepted, ['task:1', 'risk:1'])
    assert.equal(result.rejected, 3)
    for (const ref of result.accepted) {
      assert.isTrue(isContextRefWhitelisted(pack, ref))
    }
  })

  test('原则编号过滤：不在知识包内的编号被丢弃（保序去重）', ({ assert }) => {
    const result = filterPrincipleNumbers([10, 41, 0, 10, 28, Number.NaN])
    assert.deepEqual(result.kept, [10, 28])
    // 41 / 0 / NaN 三个非法编号计入丢弃；重复的 10 是去重，不计入丢弃
    assert.equal(result.dropped, 3)
    assert.deepEqual(filterPrincipleNumbers([]).kept, [])
  })

  test('模型路径：编造实体不进入草案，只留下被拒计数', async ({ assert }) => {
    const model = makeModelPort(async () =>
      modelResponse(
        modelOutputJson({ contextRefs: ['task:1', 'task:999', 'risk:7'], confidence: 0.66 }),
      ),
    )
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'ai')
    assert.equal(result.modelUsage.providerCalls, 1)
    assert.deepEqual(result.mapping.contextRefs, ['task:1'])
    assert.deepEqual(result.mapping.contextRefValidation, { accepted: 1, rejected: 2 })
    assert.include(result.mapping.qualityFlags, 'CONTEXT_REFS_REJECTED')
    const serialized = JSON.stringify(result)
    assert.notInclude(serialized, 'task:999')
    assert.notInclude(serialized, 'risk:7')
  })

  test('参数与原则的名称一律取自知识包（不采信模型文本）', async ({ assert }) => {
    const model = makeModelPort(async () =>
      modelResponse(
        modelOutputJson({
          improvingParameterNumber: 9,
          worseningParameterNumber: 31,
          candidatePrinciples: [19, 35],
        }),
      ),
    )
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    const expectedParameter = searchParameterByNumber(9)
    assert.isNotNull(expectedParameter)
    assert.equal(result.mapping.improvingParameter?.nameZh, expectedParameter!.nameZh)
    assert.equal(result.mapping.improvingParameter?.displayName, expectedParameter!.displayName)
    assert.equal(result.mapping.candidatePrinciples[0].rank, 1)
    assert.equal(result.mapping.candidatePrinciples[0].number, 19)
    for (const entry of result.mapping.candidatePrinciples) {
      assert.isTrue(entry.definition.length > 0)
      assert.include(entry.source, 'triz-')
    }
  })

  test('同一参数既是改善又是恶化 ⇒ 类型归为物理矛盾（不采信模型自述）', async ({ assert }) => {
    const model = makeModelPort(async () =>
      modelResponse(
        modelOutputJson({ improvingParameterNumber: 27, worseningParameterNumber: 27 }),
      ),
    )
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.contradictionType, 'physical')
    assert.equal(result.mapping.contradictionTypeLabel, '物理矛盾')
  })

  test('模型携带自由文本字段时整条输出被拒（自由文本无法进入草案）', async ({ assert }) => {
    const freeText = '这段模型自由文本不应进入草案'
    const model = makeModelPort(async () => modelResponse(modelOutputJson({ rationale: freeText })))
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'rule')
    assert.include(result.mapping.fallbackReasons, 'MODEL_OUTPUT_INVALID')
    assert.equal(result.modelUsage.providerCalls, 1)
    assert.notInclude(JSON.stringify(result), freeText)
  })
})

// ---------------------------------------------------------------------------
// 14 对样例逐对 + providerCalls = 0
// ---------------------------------------------------------------------------

test.group('TRIZ 矛盾映射 · 14 对样例与零真实调用', () => {
  test('14 对 PM 矛盾逐对命中（规则路径、同 Schema、providerCalls = 0）', async ({ assert }) => {
    assert.lengthOf(PAIR_STATEMENTS, 14)
    assert.lengthOf(TRIZ_PM_CONTRAIDCTION_PAIRS, 14)

    const pairById = new Map(TRIZ_PM_CONTRAIDCTION_PAIRS.map((pair) => [pair.id, pair]))
    const pack = makePack()
    const model = makeModelPort(async () => {
      throw new Error('真实模型已关闭，模型通道不应被调用')
    })
    const service = new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: false,
    })

    for (const { id, statement } of PAIR_STATEMENTS) {
      const pair = pairById.get(id)
      assert.isDefined(pair, `${id} 不在知识包内`)
      const result = await service.map(makeRequest(statement, { contextPack: pack }))

      assert.equal(result.mapping.path, 'rule', `${id} 应为规则路径`)
      assert.equal(result.modelUsage.providerCalls, 0, `${id} 不应产生 provider 调用`)
      assert.equal(result.mapping.sourceMappingIds[0], id, `${id} 命中映射不符`)
      assert.deepEqual(
        result.mapping.improvingParameter?.number,
        pair!.improvingParameterNumbers[0],
        `${id} 改善参数不符`,
      )
      assert.deepEqual(
        result.mapping.worseningParameter?.number,
        pair!.worseningParameterNumbers[0],
        `${id} 恶化参数不符`,
      )
      assert.deepEqual(
        result.mapping.candidatePrinciples.map((entry) => entry.number),
        [...pair!.principleNumbers],
        `${id} 候选原则（含排序）不符`,
      )
      assert.equal(result.mapping.contradictionType, 'technical', `${id} 应为技术矛盾`)
      assert.isAbove(result.mapping.confidence, 0, `${id} 置信度应大于 0`)
      assert.isAtMost(result.mapping.confidence, 0.8, `${id} 规则路径置信度不得超过 0.8`)
      assert.isTrue(result.mapping.sourceSections[0].includes('triz-'), `${id} 缺来源标注`)
      assert.isTrue(result.mapping.contextRefs.length > 0, `${id} 应绑定项目实体证据`)
      for (const ref of result.mapping.contextRefs) {
        assert.isTrue(isContextRefWhitelisted(pack, ref), `${id} 的引用 ${ref} 未通过白名单`)
      }
      assert.isFalse(result.mapping.needsClarification, `${id} 不应要求澄清`)
    }

    assert.lengthOf(model.calls, 0, '模型通道调用次数必须为 0')
  })

  test('spec 场景原句 → 技术矛盾、改善为生产率类、恶化为复杂度类', async ({ assert }) => {
    const model = makeModelPort(async () => {
      throw new Error('不应调用模型通道')
    })
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: false,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'rule')
    assert.equal(result.mapping.contradictionType, 'technical')
    assert.equal(result.mapping.improvingParameter?.number, 39)
    assert.equal(result.mapping.worseningParameter?.number, 36)
    assert.equal(result.modelUsage.providerCalls, 0)
    assert.lengthOf(model.calls, 0)
    // 呈现层不出现「参数编号选择」类交互文案
    assert.notInclude(JSON.stringify(result.mapping.contextRefs), '请选择')
  })

  test('同一输入两次调用结果完全一致（确定性）', async ({ assert }) => {
    const service = new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: null,
      realAiEnabled: false,
    })
    const first = await service.map(makeRequest(SPEC_STATEMENT))
    const second = await service.map(makeRequest(SPEC_STATEMENT))
    assert.deepEqual(first.mapping, second.mapping)
    assert.deepEqual(first.lowSensitivityRecord, second.lowSensitivityRecord)
  })

  test('默认配置（未开真实模型、无注入端口）零 provider 调用且不触达权限 / 模型解析', async ({
    assert,
  }) => {
    const previous = process.env.AIPROJ_TRIZ_ENABLE_REAL_AI
    delete process.env.AIPROJ_TRIZ_ENABLE_REAL_AI
    try {
      assert.isFalse(isTrizRealAiEnabled())
      const result = await new TrizContradictionMappingService().map(makeRequest(SPEC_STATEMENT))
      assert.equal(result.mapping.path, 'rule')
      assert.equal(result.modelUsage.providerCalls, 0)
      assert.deepEqual(result.mapping.fallbackReasons, ['MODEL_DISABLED'])
    } finally {
      if (previous === undefined) delete process.env.AIPROJ_TRIZ_ENABLE_REAL_AI
      else process.env.AIPROJ_TRIZ_ENABLE_REAL_AI = previous
    }
  })
  test('真实模型开关：未设置时正式环境默认开启，显式 false 关闭，测试环境保持关闭', ({
    assert,
  }) => {
    const previousFlag = process.env.AIPROJ_TRIZ_ENABLE_REAL_AI
    const previousEnv = process.env.NODE_ENV
    try {
      delete process.env.AIPROJ_TRIZ_ENABLE_REAL_AI
      process.env.NODE_ENV = 'production'
      assert.isTrue(isTrizRealAiEnabled())
      process.env.AIPROJ_TRIZ_ENABLE_REAL_AI = 'false'
      assert.isFalse(isTrizRealAiEnabled())
      process.env.NODE_ENV = 'test'
      process.env.AIPROJ_TRIZ_ENABLE_REAL_AI = 'true'
      assert.isTrue(isTrizRealAiEnabled())
      delete process.env.AIPROJ_TRIZ_ENABLE_REAL_AI
      assert.isFalse(isTrizRealAiEnabled())
    } finally {
      process.env.NODE_ENV = previousEnv
      if (previousFlag === undefined) delete process.env.AIPROJ_TRIZ_ENABLE_REAL_AI
      else process.env.AIPROJ_TRIZ_ENABLE_REAL_AI = previousFlag
    }
  })
})

// ---------------------------------------------------------------------------
// 空输入 / 歧义输入 / 超长输入
// ---------------------------------------------------------------------------

test.group('TRIZ 矛盾映射 · 输入边界', () => {
  test('空输入与纯空白直接拒绝（零模型调用）', async ({ assert }) => {
    const model = makeModelPort(async () => {
      throw new Error('不应调用模型通道')
    })
    const service = new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    })
    for (const statement of ['', '   ', '\n\t ']) {
      await assert.rejects(() => service.map(makeRequest(statement)), ValidationException)
    }
    assert.lengthOf(model.calls, 0)
  })

  test('歧义输入给出中性「信息不足」草案（不编造参数与实体）', async ({ assert }) => {
    const model = makeModelPort(async () => {
      throw new Error('不应调用模型通道')
    })
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: false,
    }).map(makeRequest('项目有点问题，说不清楚'))

    assert.equal(result.mapping.path, 'rule')
    assert.isNull(result.mapping.improvingParameter)
    assert.isNull(result.mapping.worseningParameter)
    assert.lengthOf(result.mapping.candidatePrinciples, 0)
    assert.equal(result.mapping.confidence, 0)
    assert.isTrue(result.mapping.needsClarification)
    assert.include(result.mapping.qualityFlags, 'INSUFFICIENT_INPUT')
    assert.lengthOf(result.mapping.contextRefs, 0)
    assert.equal(result.mapping.contradictionType, 'administrative')
    assert.equal(result.modelUsage.providerCalls, 0)
  })

  test('泛化词不参与规则打分（阈值由知识包条数算出，非手写词表）', ({ assert }) => {
    // 「项目」出现在 5/17 条映射中（> 1/4），无区分度；「加人」「灰度」等具体词片保留
    assert.isFalse(isDiscriminatingTrizToken('项目'))
    assert.isFalse(isDiscriminatingTrizToken('交付'))
    assert.isTrue(isDiscriminatingTrizToken('加人'))
    assert.isTrue(isDiscriminatingTrizToken('Brooks'))
    assert.isTrue(isDiscriminatingTrizToken('zzz-不存在-zzz'))
  })

  test('超长输入按上限截断并标记（原文不进入结果）', async ({ assert }) => {
    const longStatement = `${'赶工期提前交付'.repeat(400)}`
    assert.isAbove(longStatement.length, TRIZ_MAPPING_LIMITS.maxStatementChars)

    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: null,
      realAiEnabled: false,
    }).map(makeRequest(longStatement))

    assert.isTrue(result.mapping.statementTruncated)
    assert.include(result.mapping.qualityFlags, 'STATEMENT_TRUNCATED')
    assert.equal(result.mapping.statementLength, TRIZ_MAPPING_LIMITS.maxStatementChars)
    assert.equal(
      result.mapping.statementDigest,
      digestTrizStatement(longStatement.slice(0, TRIZ_MAPPING_LIMITS.maxStatementChars)),
    )
    assert.notInclude(JSON.stringify(result), longStatement.slice(0, 60))
  })

  test('上下文包与请求组织 / 项目不一致时 fail-closed', async ({ assert }) => {
    const service = new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: null,
      realAiEnabled: false,
    })
    await assert.rejects(
      () => service.map(makeRequest(SPEC_STATEMENT, { organizationId: 999 })),
      ValidationException,
    )
    await assert.rejects(
      () => service.map(makeRequest(SPEC_STATEMENT, { contextPack: makePack({ projectId: 999 }) })),
      ValidationException,
    )
  })

  test('限额默认值不可上调（只允许收紧）', ({ assert }) => {
    const raised = resolveTrizMappingLimits({ runTokenBudget: 999_999, maxOutputTokens: 999_999 })
    assert.equal(raised.runTokenBudget, TRIZ_MAPPING_LIMITS.runTokenBudget)
    assert.equal(raised.maxOutputTokens, TRIZ_MAPPING_LIMITS.maxOutputTokens)

    const tightened = resolveTrizMappingLimits({ runTokenBudget: 100, maxStatementChars: 200 })
    assert.equal(tightened.runTokenBudget, 256)
    assert.equal(tightened.maxStatementChars, 200)
  })

  test('最长陈述的默认预算可满足（估算 ≤ runTokenBudget）', ({ assert }) => {
    const statement = '赶工期提前交付但代码质量不能降低'
      .repeat(80)
      .slice(0, TRIZ_MAPPING_LIMITS.maxStatementChars)
    const prompt = buildTrizMappingPrompt({
      statement,
      pack: makePack(),
      limits: TRIZ_MAPPING_LIMITS,
    })
    assert.include(prompt.userPrompt, statement)
    assert.include(prompt.userPrompt, '39|')
    assert.include(prompt.userPrompt, '40|')
    for (const ref of prompt.entityRefs) {
      assert.isTrue(isContextRefWhitelisted(makePack(), ref))
    }
    assert.isAtMost(prompt.entityRefs.length, TRIZ_MAPPING_LIMITS.maxPromptEntityRefs)

    const estimated =
      estimateTrizMappingTokens(prompt.systemPrompt) +
      estimateTrizMappingTokens(prompt.userPrompt) +
      TRIZ_MAPPING_LIMITS.maxOutputTokens
    assert.isAtMost(estimated, TRIZ_MAPPING_LIMITS.runTokenBudget)
  })
})

// ---------------------------------------------------------------------------
// 七类回退触发
// ---------------------------------------------------------------------------

test.group('TRIZ 矛盾映射 · 确定性回退触发', () => {
  test('无 ai:trigger 权限 → 规则路径且零模型调用', async ({ assert }) => {
    const model = makeModelPort(async () => {
      throw new Error('不应调用模型通道')
    })
    const result = await new TrizContradictionMappingService({
      permissionChecker: denyTrigger(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'rule')
    assert.deepEqual(result.mapping.fallbackReasons, ['NO_AI_TRIGGER'])
    assert.equal(result.modelUsage.providerCalls, 0)
    assert.lengthOf(model.calls, 0)
  })

  test('预算阻断 → 规则路径且零模型调用', async ({ assert }) => {
    const model = makeModelPort(async () => {
      throw new Error('不应调用模型通道')
    })
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT, { limits: { runTokenBudget: 256 } }))

    assert.equal(result.mapping.path, 'rule')
    assert.include(result.mapping.fallbackReasons, 'BUDGET_EXHAUSTED')
    assert.equal(result.modelUsage.providerCalls, 0)
    assert.lengthOf(model.calls, 0)
  })

  test('通道不可用（未解析到真实适配器）→ 规则路径且零调用', async ({ assert }) => {
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: null,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'rule')
    assert.include(result.mapping.fallbackReasons, 'MODEL_UNAVAILABLE')
    assert.equal(result.modelUsage.providerCalls, 0)
  })

  test('模型调用失败 → 规则路径且 providerCalls = 1', async ({ assert }) => {
    const model = makeModelPort(async () => {
      throw new Error('provider 抖动')
    })
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'rule')
    assert.include(result.mapping.fallbackReasons, 'MODEL_FAILED')
    assert.equal(result.modelUsage.providerCalls, 1)
    assert.lengthOf(model.calls, 1)
    assert.notInclude(JSON.stringify(result), 'provider 抖动')
  })

  test('模型调用超时 → 规则路径且 providerCalls = 1', async ({ assert }) => {
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
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT, { limits: { requestTimeoutMs: 20 } }))

    assert.equal(result.mapping.path, 'rule')
    assert.include(result.mapping.fallbackReasons, 'MODEL_TIMEOUT')
    assert.equal(result.modelUsage.providerCalls, 1)
  })

  test('预算门可接线既有 UnifiedBudgetGuard（不新建预算体系）', async ({ assert }) => {
    const seen: Array<Record<string, unknown>> = []
    const gate = createUnifiedBudgetGate({
      preflight: async (input) => {
        seen.push(input as unknown as Record<string, unknown>)
        return {
          allowed: false,
          outcome: 'block',
          reasonCode: 'hard_limit_tokens_exceeded',
          reason: '组织 AI 预算已耗尽',
          triggeringScope: null,
          triggeringPolicyName: null,
          appliedPolicies: ['org-monthly'],
          degradation: null,
          decisionRecord: {} as never,
        }
      },
    })

    const decision: TrizMappingBudgetDecision = await gate.preflight({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      userId: 7,
      capability: TRIZ_MAPPING_CAPABILITY,
      surface: 'triz_copilot_mapping',
      estimatedTokens: 1200,
      estimatedCost: 0,
      idempotencyKey: 'triz-mapping-fixture',
      ledgerAttemptRef: null,
    })

    assert.isFalse(decision.allowed)
    assert.equal(decision.reasonCode, 'hard_limit_tokens_exceeded')
    assert.lengthOf(seen, 1)
    assert.equal(seen[0].capability, TRIZ_MAPPING_CAPABILITY)
    assert.equal(seen[0].estimatedTokens, 1200)
    assert.equal(seen[0].idempotencyKey, 'triz-mapping-fixture')

    // 守卫返回 block 时映射服务整体降级（providerCalls = 0）
    const model = makeModelPort(async () => {
      throw new Error('不应调用模型通道')
    })
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
      budgetGate: gate,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.equal(result.mapping.path, 'rule')
    assert.include(result.mapping.fallbackReasons, 'BUDGET_EXHAUSTED')
    assert.equal(result.modelUsage.providerCalls, 0)
    assert.lengthOf(model.calls, 0)
  })
})

// ---------------------------------------------------------------------------
// 人工确认关卡：只产草案 / 零业务表写入 / 低敏
// ---------------------------------------------------------------------------

test.group('TRIZ 矛盾映射 · 只产草案与低敏边界', () => {
  test('服务原型只暴露 map 一个公开方法（无落库 / 确认通道）', ({ assert }) => {
    assert.deepEqual(Object.getOwnPropertyNames(TrizContradictionMappingService.prototype).sort(), [
      'constructor',
      'map',
    ])
  })

  test('模块内无数据访问与写入特征（含特征表自检防静默空转）', ({ assert }) => {
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
    assert.isAbove(source.length, 4000, '源文件读取异常，静态断言可能空转')
    for (const [pattern, label] of WRITE_PATTERNS) {
      assert.isFalse(pattern.test(source), `命中数据访问 / 写入特征：${label}`)
    }
  })

  test('草案显式声明未落库且必须经人工确认', async ({ assert }) => {
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: null,
      realAiEnabled: false,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.isFalse(result.mapping.persisted)
    assert.isTrue(result.mapping.requiresHumanConfirmation)
    const serialized = JSON.stringify(result.mapping)
    assert.notInclude(serialized, 'prompt')
    assert.notInclude(serialized, 'rawText')
    assert.notInclude(serialized, 'fixture-model')
  })

  test('落库投影字段表冻结：只有编号 / 枚举 / 摘要 / 引用', async ({ assert }) => {
    const model = makeModelPort(async () => modelResponse(modelOutputJson()))
    const result = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    const record = result.lowSensitivityRecord
    assert.deepEqual(Object.keys(record).sort(), [
      'candidatePrincipleNumbers',
      'confidence',
      'contextRefs',
      'contradictionType',
      'humanOverride',
      'improvingParameterNumber',
      'knowledgePackVersion',
      'path',
      'statementDigest',
      'statementLength',
      'worseningParameterNumber',
    ])
    assert.isFalse(record.humanOverride)
    assert.equal(record.statementDigest, digestTrizStatement(SPEC_STATEMENT))

    for (const [key, value] of Object.entries(record)) {
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) {
        if (typeof item === 'string') {
          assert.isBelow(item.length, 64, `${key} 出现过长的字符串值`)
        }
        assert.notMatch(String(item), /陈述|prompt/i, `${key} 不应承载全文类内容`)
      }
    }

    // 模型输出全文与陈述原文都不在投影里
    const serialized = JSON.stringify(record)
    assert.notInclude(serialized, SPEC_STATEMENT.slice(0, 12))
    assert.notInclude(serialized, modelOutputJson())
    assert.notInclude(serialized, 'fixture-provider')
  })

  test('规则路径与模型路径产出同 Schema（字段集合一致）', async ({ assert }) => {
    const ruleResult = buildTrizRulePathDraft({
      statement: SPEC_STATEMENT,
      pack: makePack(),
      statementTruncated: false,
      fallbackReasons: ['MODEL_DISABLED'],
      limits: TRIZ_MAPPING_LIMITS,
    })

    const model = makeModelPort(async () => modelResponse(modelOutputJson()))
    const aiResult: TrizContradictionMappingResult = await new TrizContradictionMappingService({
      permissionChecker: allowAll(),
      model: model.port,
      realAiEnabled: true,
    }).map(makeRequest(SPEC_STATEMENT))

    assert.deepEqual(
      Object.keys(ruleResult).sort(),
      Object.keys(aiResult.mapping).sort(),
      '两条路径的草案字段集合必须一致',
    )
    assert.deepEqual(
      Object.keys(toLowSensitivityRecord(ruleResult)).sort(),
      Object.keys(aiResult.lowSensitivityRecord).sort(),
    )
  })
})
