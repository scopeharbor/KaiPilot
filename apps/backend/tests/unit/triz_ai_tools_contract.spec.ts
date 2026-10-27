// v3-triz-contradiction-copilot 任务 2.4 —— TRIZ 矛盾求解 AI 工具契约单测（W2b，W4 补第 6 个工具）。
//
// 覆盖（tasks 2.4 验收口径：W2b 5 个 + W4 补 `list_project_signals`）：
// 1. 元数据投影：在册清单 = 既有 8 + 新增 6 = 14，字段完备且不泄漏 handler（RL-14）；
// 2. 权限清单：读工具 `project:view`；写工具按目标实体写权限（参考既有 Policy 三元组签名）；
// 3. 输入 Schema 校验：缺必填 / 多字段 / 类型错 / 序号越界一律 422（确定性 JSON Schema 子集）；
// 4. 写工具必须返回预览：execute 阶段恒 `PREVIEW_REQUIRED` + 64 位十六进制 previewToken + 差异预览；
// 5. 写工具 execute 零落库：**静态**（handler 源码无业务表写入调用）+ **运行时**（未确认时绝不
//    触达提交服务）双断言；
// 6. 既有 8 工具的契约零变化（名称 / 副作用 / 权限三元组逐条回归）。
//
// 本文件不连数据库：领域服务与提交服务以确定性假实现注入（fixture 语义）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'
import { ValidationException } from '#exceptions/api_exception'
import { AiToolsRegistry } from '#services/ai_tools/registry'
import type { ToolDefinition, ToolExecutionContext } from '#services/ai_tools/registry'
import {
  AI_TOOLS_NAMES,
  ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME,
  CREATE_CHANGE_REQUEST_FROM_INTERVENTION_TOOL_NAME,
  CREATE_RISK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_TASK_FROM_INTERVENTION_TOOL_NAME,
  GET_TRIZ_ANALYSIS_TOOL_NAME,
  LIST_PROJECT_SIGNALS_TOOL_NAME,
  buildAllAiToolDefinitions,
} from '#services/ai_tools/handlers/index'
import { validateParametersWithSchema } from '#validators/ai_tools_validator'
import {
  createAnalyzeProjectContradictionTool,
  type AnalyzeProjectContradictionResult,
} from '#services/ai_tools/handlers/analyze_project_contradiction'
import { createGetTrizAnalysisTool } from '#services/ai_tools/handlers/get_triz_analysis'
import {
  canReadSignalEvidence,
  requiredPermissionFor,
} from '#services/project_signal/signal_permissions'
import {
  createCreateTaskFromInterventionTool,
  type CreateTaskFromInterventionParams,
} from '#services/ai_tools/handlers/create_task_from_intervention'
import {
  createCreateRiskFromInterventionTool,
  type CreateRiskFromInterventionParams,
} from '#services/ai_tools/handlers/create_risk_from_intervention'
import {
  createCreateChangeRequestFromInterventionTool,
  type CreateChangeRequestFromInterventionParams,
} from '#services/ai_tools/handlers/create_change_request_from_intervention'
import type TrizCopilotAnalysisService from '#services/triz_copilot/triz_copilot_analysis_service'
import type TrizCopilotAnalysis from '#models/triz_copilot_analysis'
import type User from '#models/user'
import type TrizInterventionCommitService from '#services/triz_copilot/triz_intervention_commit_service'
import type { TrizInterventionCommitRequest } from '#services/triz_copilot/triz_intervention_commit_service'

/** 本波新增工具清单（顺序即注册顺序；W4 补第 6 个 `list_project_signals`）。 */
const W2B_TOOL_NAMES = [
  ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME,
  GET_TRIZ_ANALYSIS_TOOL_NAME,
  CREATE_TASK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_RISK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_CHANGE_REQUEST_FROM_INTERVENTION_TOOL_NAME,
  LIST_PROJECT_SIGNALS_TOOL_NAME,
] as const

/** 新增工具里的只读子集（3 个：映射 / 分析依据 / 被动雷达信号列表）。 */
const ADDED_READ_TOOL_NAMES = [
  ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME,
  GET_TRIZ_ANALYSIS_TOOL_NAME,
  LIST_PROJECT_SIGNALS_TOOL_NAME,
] as const

/** 新增工具里的写子集（3 个：任务 / 风险 / 变更请求）。 */
const ADDED_WRITE_TOOL_NAMES = [
  CREATE_TASK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_RISK_FROM_INTERVENTION_TOOL_NAME,
  CREATE_CHANGE_REQUEST_FROM_INTERVENTION_TOOL_NAME,
] as const

/** 既有 8 工具的契约三元组（本 change MUST NOT 改动它们）。 */
const LEGACY_CONTRACTS: ReadonlyArray<{
  name: string
  sideEffect: string
  permissions: string[]
}> = [
  { name: 'navigate_to_space', sideEffect: 'navigate', permissions: ['project:view'] },
  { name: 'get_project_summary', sideEffect: 'read', permissions: ['project:view'] },
  { name: 'list_project_tasks', sideEffect: 'read', permissions: ['task:view'] },
  { name: 'get_task_detail', sideEffect: 'read', permissions: ['task:view'] },
  { name: 'list_project_risks', sideEffect: 'read', permissions: ['risk:view'] },
  { name: 'get_gantt_snapshot', sideEffect: 'read', permissions: ['gantt:view'] },
  {
    name: 'search_projects_tasks',
    sideEffect: 'read',
    permissions: ['project:view', 'task:view'],
  },
  { name: 'update_task_schedule', sideEffect: 'write', permissions: ['task:update'] },
]

const DUMMY_USER = { id: 7, isSuperAdmin: false } as User

function ctxFor(): ToolExecutionContext {
  return { user: DUMMY_USER, organizationId: 42, requestId: 'triz-tool-contract' }
}

const VALID_WRITE_INPUT = { projectId: 11, analysisId: 5, solutionIndex: 2 } as const

/** 逐工具的合法入参（读工具与写工具的必填集不同）。 */
const VALID_INPUTS: Readonly<Record<string, Record<string, unknown>>> = {
  [ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME]: {
    projectId: 11,
    statement: '客户催进度，但再加人测试就跟不上了',
  },
  [GET_TRIZ_ANALYSIS_TOOL_NAME]: { projectId: 11, analysisId: 5 },
  [LIST_PROJECT_SIGNALS_TOOL_NAME]: { projectId: 11 },
  [CREATE_TASK_FROM_INTERVENTION_TOOL_NAME]: { ...VALID_WRITE_INPUT },
  [CREATE_RISK_FROM_INTERVENTION_TOOL_NAME]: { ...VALID_WRITE_INPUT },
  [CREATE_CHANGE_REQUEST_FROM_INTERVENTION_TOOL_NAME]: { ...VALID_WRITE_INPUT },
}

/** 断言「该调用被确定性校验拒绝」，并给出定位用的标签（比 assert.throws 的报错更好定位）。 */
function assertRejected(fn: () => void, label: string): void {
  try {
    fn()
  } catch (error) {
    if (error instanceof ValidationException) return
    throw new Error(`${label}：期望 ValidationException，实际抛出 ${String(error)}`)
  }
  throw new Error(`${label}：期望被拒绝，实际通过了校验`)
}

/** 差异化写工具：记录调用并按调用方要求返回预览 / 确认结果。 */
class RecordingInterventionService {
  readonly previewCalls: Array<{ target: string; request: unknown }> = []
  readonly commitCalls: Array<{ target: string; request: TrizInterventionCommitRequest }> = []

  async preview(
    target: string,
    request: { solutionIndex: number },
  ): Promise<{
    status: 'PREVIEW_REQUIRED'
    previewToken: string
    diff: Record<string, unknown>
  }> {
    this.previewCalls.push({ target, request })
    return {
      status: 'PREVIEW_REQUIRED',
      previewToken: 'a'.repeat(64),
      diff: { target, operation: 'create', entity: {}, provenance: {}, links: [], notes: [] },
    }
  }

  async commit(
    target: string,
    request: TrizInterventionCommitRequest,
  ): Promise<{
    target: string
    committed: true
    entityId: number
    entity: Record<string, unknown>
    provenance: Record<string, unknown>
  }> {
    this.commitCalls.push({ target, request })
    return { target, committed: true, entityId: 9001, entity: {}, provenance: {} }
  }
}

function asCommitService(service: RecordingInterventionService): TrizInterventionCommitService {
  return service as unknown as TrizInterventionCommitService
}

/** 只读工具的确定性假分析服务（不连库、不调模型）。 */
function fakeAnalysisService(): TrizCopilotAnalysisService {
  const analysisDto = {
    id: 5,
    organizationId: 42,
    projectId: 11,
    createdBy: 7,
    parentAnalysisId: null,
    sourceSignalId: null,
    contradictionType: 'technical',
    contradictionTypeLabel: '技术矛盾',
    improvingParameter: {
      number: 39,
      nameZh: '生产率',
      displayName: '生产率',
      pmMeaning: '交付吞吐',
    },
    worseningParameter: {
      number: 27,
      nameZh: '可靠性',
      displayName: '可靠性',
      pmMeaning: '质量稳定',
    },
    candidatePrinciples: [
      {
        rank: 1,
        number: 35,
        nameZh: '参数变化',
        displayName: '参数变化',
        definition: '改变对象的物理状态参数',
        source: 'triz-fundamentals §二',
      },
    ],
    path: 'rule',
    confidence: 0.7,
    entityBinding: 'bound',
    contextRefs: ['task:3'],
    qualityFlags: [],
    fallbackReasons: ['MODEL_DISABLED'],
    knowledgePackVersion: 'triz-kp-1',
    statement: { digest: 'f'.repeat(32), length: 12, truncated: false },
    topSolutions: {
      path: 'rule',
      entityBinding: 'bound',
      solutions: [
        { index: 1, principleNumber: 35, title: '方案一', score: 0.7, entityRefs: ['task:3'] },
      ],
      excludedPrincipleNumbers: [],
      contextRefValidation: { accepted: 1, rejected: 0 },
      qualityFlags: [],
      knowledgePackVersion: 'triz-kp-1',
    },
    humanOverride: false,
    overrideBy: null,
    overrideAt: null,
    budget: {
      clarificationRounds: 0,
      metricReadCount: 0,
      tokenBudget: 4000,
      estimatedTokens: 0,
      actualTokens: null,
      state: 'within_budget',
      reason: null,
    },
    createdAt: null,
    updatedAt: null,
  }
  const solveResult = {
    record: { id: 5 } as TrizCopilotAnalysis,
    analysis: analysisDto,
    mapping: {
      path: 'rule',
      contradictionType: 'technical',
      contradictionTypeLabel: '技术矛盾',
      improvingParameter: analysisDto.improvingParameter,
      worseningParameter: analysisDto.worseningParameter,
      candidatePrinciples: analysisDto.candidatePrinciples,
      confidence: 0.7,
      contextRefs: ['task:3'],
      sourceMappingIds: ['pm-pair-01'],
      sourceSections: ['triz-fundamentals §3.3'],
      qualityFlags: [],
      fallbackReasons: ['MODEL_DISABLED'],
      needsClarification: false,
    },
    solutions: [
      {
        index: 1,
        title: '方案一',
        principle: { number: 35, nameZh: '参数变化' },
        actionPoints: [],
        impact: { positive: '', negative: '' },
        preconditions: [],
        entityRefs: ['task:3'],
        entityBinding: 'bound',
        ranking: { principleStrength: 1, contextMatch: 1, executability: 1, score: 1 },
        toppedUp: false,
        requiresHumanConfirmation: true,
        persisted: false,
      },
    ],
    solutionSet: {
      solutions: [],
      entityBinding: 'bound',
      candidatePrincipleNumbers: [35],
      excludedPrincipleNumbers: [],
      path: 'rule',
      contradictionType: 'technical',
      sourceMappingIds: ['pm-pair-01'],
      contextRefValidation: { accepted: 1, rejected: 0 },
      qualityFlags: [],
      insufficientMapping: false,
      knowledgePackVersion: 'triz-kp-1',
      requiresHumanConfirmation: true,
      persisted: false,
    },
    clarification: {
      needed: false,
      asked: false,
      round: 0,
      maxRounds: 2,
      exhausted: false,
      prompt: null,
      reason: null,
    },
    budget: analysisDto.budget,
    modelUsage: {
      providerCalls: 0,
      provider: null,
      model: null,
      estimatedTokens: 0,
      totalTokens: 0,
    },
  }
  return {
    solve: async () => solveResult,
    findById: async () => ({ id: 5 }) as TrizCopilotAnalysis,
    toDTO: () => analysisDto,
  } as unknown as TrizCopilotAnalysisService
}

const HANDLER_PATHS = [
  'app/services/ai_tools/handlers/analyze_project_contradiction.ts',
  'app/services/ai_tools/handlers/get_triz_analysis.ts',
  'app/services/ai_tools/handlers/list_project_signals.ts',
  'app/services/ai_tools/handlers/create_task_from_intervention.ts',
  'app/services/ai_tools/handlers/create_risk_from_intervention.ts',
  'app/services/ai_tools/handlers/create_change_request_from_intervention.ts',
]

/** 三个写工具 handler（提交调用必须在令牌非空判定之后）。 */
const WRITE_HANDLER_PATHS = [
  'app/services/ai_tools/handlers/create_task_from_intervention.ts',
  'app/services/ai_tools/handlers/create_risk_from_intervention.ts',
  'app/services/ai_tools/handlers/create_change_request_from_intervention.ts',
]

/** 业务表直接写入调用的形态（handler 层严禁出现；落库只允许在确认服务的事务内）。 */
const DIRECT_WRITE_PATTERN =
  /db\.transaction|\.create\(\s*\{|Query\(\{ client|\.insert\(|\.update\(|\.delete\(|\.save\(\)/

test.group('TRIZ AI 工具契约（W2b）', () => {
  test('注册表元数据投影：既有 8 + 矛盾求解 6 + 任务状态 1 + 我的工作 1 + 改负责人 1 + 删除任务 1 + 新建任务 1 + 勾选步骤 1 + 改设置 1 + 维基只读 3 = 24，字段完备且零 handler 泄漏（RL-14）', ({
    assert,
  }) => {
    const metadata = AiToolsRegistry.getInstance().getAllMetadata()
    const names = metadata.map((tool) => tool.name)
    assert.lengthOf(metadata, 24)
    assert.include(names, 'update_setting')
    // v3-llm-wiki-query-navigation：只读维基工具
    for (const name of ['wiki_index', 'wiki_read', 'wiki_search']) assert.include(names, name)
    // AI 同事自然语言操作：任务状态写工具（元数据 14 → 15）
    assert.include(names, 'update_task_status')
    assert.include(names, 'get_my_work')
    assert.include(names, 'update_task_assignee')
    assert.include(names, 'delete_task')
    assert.include(names, 'create_task')
    assert.include(names, 'toggle_task_steps')
    assert.deepEqual([...names].sort(), [...AI_TOOLS_NAMES].sort())
    for (const name of W2B_TOOL_NAMES) assert.include(names, name)
    // W4 补位：被动雷达只读工具已注册（元数据 13 → 14）
    assert.include(names, 'list_project_signals')

    for (const descriptor of metadata) {
      assert.isString(descriptor.description)
      assert.isAbove(descriptor.description.length, 0)
      assert.isArray(descriptor.requiredPermissions)
      assert.isObject(descriptor.parameters)
      assert.isObject(descriptor.parametersJsonSchema)
      assert.isTrue(['read', 'navigate', 'write'].includes(descriptor.sideEffect))
      assert.isUndefined(
        (descriptor as unknown as Record<string, unknown>).handler,
        `工具「${descriptor.name}」元数据不得泄漏 handler 实现`,
      )
    }
    assert.isTrue(AiToolsRegistry.getInstance().isSealed())
  })

  test('既有 8 工具的契约零变化（名称 / 副作用 / 权限三元组）', ({ assert }) => {
    const definitions = buildAllAiToolDefinitions()
    const byName = new Map(definitions.map((definition) => [definition.name, definition]))
    for (const legacy of LEGACY_CONTRACTS) {
      const definition = byName.get(legacy.name)
      assert.isDefined(definition, `既有工具「${legacy.name}」仍在册`)
      assert.equal(definition?.sideEffect, legacy.sideEffect)
      assert.deepEqual([...(definition?.requiredPermissions ?? [])], legacy.permissions)
    }
  })

  test('权限清单：读工具 project:view，写工具按目标实体写权限', ({ assert }) => {
    const definitions = buildAllAiToolDefinitions()
    const byName = new Map(definitions.map((definition) => [definition.name, definition]))
    assert.deepEqual(
      [...(byName.get(ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME)?.requiredPermissions ?? [])],
      ['project:view'],
    )
    assert.deepEqual(
      [...(byName.get(GET_TRIZ_ANALYSIS_TOOL_NAME)?.requiredPermissions ?? [])],
      ['project:view'],
    )
    assert.deepEqual(
      [...(byName.get(CREATE_TASK_FROM_INTERVENTION_TOOL_NAME)?.requiredPermissions ?? [])],
      ['task:create'],
    )
    assert.deepEqual(
      [...(byName.get(CREATE_RISK_FROM_INTERVENTION_TOOL_NAME)?.requiredPermissions ?? [])],
      ['risk:manage'],
    )
    assert.deepEqual(
      [
        ...(byName.get(CREATE_CHANGE_REQUEST_FROM_INTERVENTION_TOOL_NAME)?.requiredPermissions ??
          []),
      ],
      ['change_request:create'],
    )
    assert.deepEqual(
      [...(byName.get(LIST_PROJECT_SIGNALS_TOOL_NAME)?.requiredPermissions ?? [])],
      ['project:view'],
    )
    for (const name of ADDED_READ_TOOL_NAMES) {
      assert.equal(byName.get(name)?.sideEffect, 'read')
    }
    for (const name of ADDED_WRITE_TOOL_NAMES) {
      assert.equal(byName.get(name)?.sideEffect, 'write')
    }
  })

  test('输入 Schema 校验：缺必填 / 多余字段 / 类型错 / 序号越界一律被拒', () => {
    const definitions = buildAllAiToolDefinitions()
    for (const definition of definitions.filter((tool) =>
      (W2B_TOOL_NAMES as readonly string[]).includes(tool.name),
    )) {
      const schema = definition.parametersJsonSchema
      const valid = VALID_INPUTS[definition.name] ?? { ...VALID_WRITE_INPUT }
      validateParametersWithSchema(schema, valid)
      assertRejected(() => validateParametersWithSchema(schema, {}), `${definition.name} 缺必填`)
      assertRejected(
        () => validateParametersWithSchema(schema, { ...valid, evil: 'injected' }),
        `${definition.name} 额外字段`,
      )
      assertRejected(
        () => validateParametersWithSchema(schema, { ...valid, projectId: '11; DROP TABLE' }),
        `${definition.name} 类型错`,
      )
    }

    const taskTool = definitions.find(
      (tool) => tool.name === CREATE_TASK_FROM_INTERVENTION_TOOL_NAME,
    )
    assertRejected(
      () =>
        validateParametersWithSchema(taskTool?.parametersJsonSchema ?? {}, {
          ...VALID_WRITE_INPUT,
          solutionIndex: 4,
        }),
      '一期只呈现 Top 3：序号 4 越界',
    )
    const analyzeTool = definitions.find(
      (tool) => tool.name === ANALYZE_PROJECT_CONTRADICTION_TOOL_NAME,
    )
    assertRejected(
      () =>
        validateParametersWithSchema(analyzeTool?.parametersJsonSchema ?? {}, {
          projectId: 11,
          statement: 'x'.repeat(4001),
        }),
      '陈述超长（>4000）应被拒（结构化截断由映射服务承担）',
    )
  })

  test('只读工具 analyze_project_contradiction：委托分析服务并回低敏草案（无陈述原文）', async ({
    assert,
  }) => {
    const calls: Array<{
      organizationId: number
      projectId: number
      statement: string
      user: User
      parentAnalysisId: number | null
      sourceSignalId?: number | null
      forceRulePath: boolean
    }> = []
    const service = fakeAnalysisService()
    const recording = {
      ...service,
      solve: async (request: {
        organizationId: number
        projectId: number
        statement: string
        user: User
        parentAnalysisId: number | null
        sourceSignalId?: number | null
        forceRulePath: boolean
      }) => {
        calls.push(request)
        return service.solve(request as never)
      },
    } as unknown as TrizCopilotAnalysisService

    const tool = createAnalyzeProjectContradictionTool({ analysisService: recording })
    assert.equal(tool.sideEffect, 'read')
    assert.deepEqual([...tool.requiredPermissions], ['project:view'])

    const result = await tool.handler(ctxFor(), {
      projectId: 11,
      statement: '客户催进度，但再加人测试就跟不上了',
      sourceSignalId: 101,
    })
    assert.equal(result.status, 'SUCCESS')
    const data = result.data as AnalyzeProjectContradictionResult
    assert.equal(calls.length, 1)
    assert.equal(calls[0].organizationId, 42)
    assert.equal(calls[0].projectId, 11)
    assert.equal(calls[0].sourceSignalId, 101)
    assert.equal(data.analysisPersisted, true)
    assert.equal(data.requiresHumanConfirmation, true)
    assert.equal(data.mapping.path, 'rule')
    assert.equal(data.modelUsage.providerCalls, 0)
    assert.deepEqual(data.solutionSet.candidatePrincipleNumbers, [35])
    // RL-12：响应中不含陈述原文（只有 digest 与长度）
    assert.notInclude(JSON.stringify(data), '客户催进度，但再加人测试就跟不上了')
  })

  test('只读工具 get_triz_analysis：按 ID 读回依据，不触发新求解', async ({ assert }) => {
    let solveCalls = 0
    let findCalls = 0
    const service = fakeAnalysisService() as unknown as Record<string, unknown>
    const recording = {
      ...service,
      solve: async () => {
        solveCalls += 1
        throw new Error('只读工具不得触发求解')
      },
      findById: async () => {
        findCalls += 1
        return { id: 5 } as TrizCopilotAnalysis
      },
      toDTO: () => (fakeAnalysisService().toDTO as (record: unknown) => unknown)({ id: 5 }),
    } as unknown as TrizCopilotAnalysisService

    const tool = createGetTrizAnalysisTool({ analysisService: recording })
    assert.equal(tool.sideEffect, 'read')
    const result = await tool.handler(ctxFor(), { projectId: 11, analysisId: 5 })
    assert.equal(result.status, 'SUCCESS')
    assert.equal(solveCalls, 0)
    assert.equal(findCalls, 1)
    assert.equal((result.data as { id: number }).id, 5)
  })

  test('只读工具 list_project_signals：元数据投影 / 闭集 Schema（perm 与领域裁剪口径）', ({
    assert,
  }) => {
    const definitions = buildAllAiToolDefinitions()
    const definition = definitions.find((tool) => tool.name === LIST_PROJECT_SIGNALS_TOOL_NAME)
    assert.isDefined(definition, '被动雷达只读工具必须在册（tasks 2.4 元数据 14 条）')
    assert.equal(definition?.sideEffect, 'read')
    assert.deepEqual([...(definition?.requiredPermissions ?? [])], ['project:view'])
    assert.include(String(definition?.description), '只读')

    const schema = definition?.parametersJsonSchema as {
      required?: string[]
      additionalProperties?: boolean
      properties?: Record<string, { enum?: string[]; maximum?: number }>
    }
    assert.deepEqual(schema.required, ['projectId'])
    assert.isFalse(schema.additionalProperties, '入参闭集：不接受额外字段')
    assert.deepEqual([...(schema.properties?.status?.enum ?? [])].sort(), [
      'adopted',
      'all',
      'dismissed',
      'expired',
      'open',
    ])
    assert.deepEqual([...(schema.properties?.confidenceTier?.enum ?? [])].sort(), ['high', 'low'])
    assert.deepEqual([...(schema.properties?.signalType?.enum ?? [])].sort(), [
      'milestone_slip',
      'progress_deviation',
      'resource_overload',
      'risk_surge',
    ])
    assert.equal(schema.properties?.perPage?.maximum, 100)

    // 只读契约：工具名不得落在写工具集合内，且 Schema 不接受 previewToken（编排层 confirm 注入）
    assert.notInclude([...ADDED_WRITE_TOOL_NAMES], LIST_PROJECT_SIGNALS_TOOL_NAME)
    assert.isUndefined(schema.properties?.previewToken)

    // 领域权限裁剪口径：由 W3 的单一映射表定义（缺域权限 ⇒ 证据被裁剪，不整体拒绝）
    assert.equal(requiredPermissionFor('risk_surge'), 'risk:view')
    assert.equal(requiredPermissionFor('resource_overload'), 'resource:view')
    assert.equal(requiredPermissionFor('milestone_slip'), 'milestone:view')
    assert.equal(requiredPermissionFor('progress_deviation'), 'task:view')
    assert.isFalse(canReadSignalEvidence('risk_surge', { 'task:view': true }))
    assert.isTrue(canReadSignalEvidence('risk_surge', { 'risk:view': true }))
  })

  test('写工具 execute 恒返回 PREVIEW_REQUIRED + 预览令牌，且绝不触达提交路径', async ({
    assert,
  }) => {
    const recording = new RecordingInterventionService()
    const tools: Array<{
      tool: ToolDefinition<
        | CreateTaskFromInterventionParams
        | CreateRiskFromInterventionParams
        | CreateChangeRequestFromInterventionParams
      >
      target: string
    }> = [
      {
        tool: createCreateTaskFromInterventionTool({
          interventionService: asCommitService(recording),
        }) as unknown as ToolDefinition<CreateTaskFromInterventionParams>,
        target: 'task',
      },
      {
        tool: createCreateRiskFromInterventionTool({
          interventionService: asCommitService(recording),
        }) as unknown as ToolDefinition<CreateRiskFromInterventionParams>,
        target: 'risk',
      },
      {
        tool: createCreateChangeRequestFromInterventionTool({
          interventionService: asCommitService(recording),
        }) as unknown as ToolDefinition<CreateChangeRequestFromInterventionParams>,
        target: 'change_request',
      },
    ]

    for (const entry of tools) {
      assert.equal(entry.tool.sideEffect, 'write')
      const result = await entry.tool.handler(ctxFor(), { ...VALID_WRITE_INPUT })
      assert.equal(result.status, 'PREVIEW_REQUIRED')
      assert.match(String(result.previewToken), /^[0-9a-f]{64}$/)
      assert.isObject(result.diff)
      assert.equal(recording.commitCalls.length, 0, '未确认前不得调用提交路径')
    }
    assert.deepEqual(
      recording.previewCalls.map((call) => call.target),
      ['task', 'risk', 'change_request'],
    )
  })

  test('写工具带合法令牌才走确认路径（且确认结果不含 previewToken）', async ({ assert }) => {
    const recording = new RecordingInterventionService()
    const tool = createCreateTaskFromInterventionTool({
      interventionService: asCommitService(recording),
    })
    const confirmed = await tool.handler(ctxFor(), {
      ...VALID_WRITE_INPUT,
      previewToken: 'b'.repeat(64),
    })
    assert.equal(confirmed.status, 'SUCCESS')
    assert.isUndefined(confirmed.previewToken)
    assert.equal(recording.commitCalls.length, 1)
    assert.equal(recording.commitCalls[0].target, 'task')
    assert.equal(recording.commitCalls[0].request.previewToken, 'b'.repeat(64))
    assert.equal(recording.commitCalls[0].request.analysisId, 5)
    assert.equal(recording.commitCalls[0].request.solutionIndex, 2)
    assert.equal(recording.commitCalls[0].request.actorUserId, 7)
  })

  test('写工具 execute 零落库：handler 源码静态断言（无业务表写入调用）', ({ assert }) => {
    for (const relativePath of HANDLER_PATHS) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8')
      const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      assert.notMatch(
        stripped,
        DIRECT_WRITE_PATTERN,
        `${relativePath} 不得直接写业务表（落库只允许在确认服务的事务内）`,
      )
      assert.notInclude(stripped, 'Task.create', `${relativePath} 不得直接建任务`)
      assert.notInclude(stripped, 'Risk.create', `${relativePath} 不得直接建风险`)
      assert.notInclude(stripped, 'ChangeRequest.create', `${relativePath} 不得直接建变更请求`)
    }

    // 三个写工具的提交调用必须出现在「令牌非空」判定之后（无令牌绝无落库分支）
    for (const relativePath of WRITE_HANDLER_PATHS) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8')
      const guardIndex = source.indexOf("if (token !== '')")
      const commitIndex = source.indexOf('service.commit(')
      assert.isAbove(guardIndex, -1, `${relativePath} 缺少令牌非空判定`)
      assert.isAbove(commitIndex, guardIndex, `${relativePath} 的提交调用必须在令牌判定之后`)
      assert.include(source, 'PREVIEW_REQUIRED', `${relativePath} 必须声明预览状态`)
    }
  })

  test('落库目标闭集：三个写工具只允许 task / risk / change_request', ({ assert }) => {
    const definitions = buildAllAiToolDefinitions()
    for (const definition of definitions.filter((tool) =>
      (W2B_TOOL_NAMES as readonly string[]).includes(tool.name),
    )) {
      const schema = definition.parametersJsonSchema as {
        properties?: Record<string, { enum?: string[] }>
      }
      // 本能力不得出现「一键执行删除任务 / 改基线 / 调预算」类工具
      assert.notMatch(definition.name, /delete|remove|baseline|budget/i)
      assert.isUndefined(schema.properties?.target, '目标类型由工具名固定，不接受调用方指定')
      assert.isUndefined(
        schema.properties?.previewToken,
        'previewToken 由编排层 confirm 信封注入，不进工具 Schema',
      )
    }
  })
})
