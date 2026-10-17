// v3-triz-contradiction-copilot tasks 4.2 —— 预填服务与矩阵参数对投影单测。
//
// 覆盖（tasks 4.2 验收 + spec「九屏幕 3×3 空间卡件」第 3/6 条、「功能分析节点关系图件」第 2 条、
// 「矛盾矩阵交互网格件」第 2 条、design 红线 RL-12 / RL-13）：
// - 模型路径 fixture：注入假模型通道（providerCalls=1），输出只取白名单内的实体引用；
// - 默认 fixture：不注入模型通道、真实模型默认关闭 ⇒ 确定性模板路径，`providerCalls = 0`；
// - 回退路径逐条：强制模板 / 无 ai:trigger / 通道不可用 / 调用失败 / 超时 / 输出非法；
// - 反幻觉白名单拒绝路径：模型引用编造实体 ⇒ 该格降级通用模板、节点整颗丢弃，只记计数；
// - 矩阵空单元中性提示 + 参数边界（0 / 40 / 非整数 → 中性空结果，不抛错）；
// - 不落库：静态扫描预填服务源码（无模型导入 / 无 query / 无写入调用）+ 运行时 `persisted=false`。
import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ValidationException } from '#exceptions/api_exception'
import { AI_TRIGGER } from '#rbac'
import {
  TRIZ_CONTEXT_PACK_LIMITS,
  isContextRefWhitelisted,
  type TrizContextPack,
  type TrizContextPermissionChecker,
} from '#services/triz_copilot/triz_context_pack_service'
import TrizGalleryPrefillService, {
  TRIZ_GALLERY_PREFILL_LIMITS,
  TRIZ_NINE_WINDOWS_CENTER_KEY,
  TRIZ_NINE_WINDOWS_CELL_ORDER,
  buildTrizGalleryPrefillPrompt,
  genericNineWindowsCell,
  parseTrizGalleryPrefillModelOutput,
  resolveTrizGalleryPrefillLimits,
  type TrizFunctionAnalysisPrefillDraft,
  type TrizGalleryPrefillGenerationRequest,
  type TrizGalleryPrefillGenerationResponse,
  type TrizGalleryPrefillModelPort,
  type TrizGalleryPrefillRequest,
  type TrizNineWindowsPrefillDraft,
} from '#services/triz_copilot/triz_gallery_prefill_service'
import {
  TRIZ_GALLERY_MATRIX_EMPTY_HINT,
  projectMatrixPrinciples,
} from '#services/triz_copilot/triz_gallery_matrix_service'

const SERVICE_RELATIVE_PATH = '../../app/services/triz_copilot/triz_gallery_prefill_service.ts'

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

const ORG_ID = 11
const PROJECT_ID = 22
const ACTOR = { id: 7 } as unknown as Parameters<TrizContextPermissionChecker['check']>[0]

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
            label: '联调排期逾期',
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
            label: '灰度发布窗口扩展',
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
      riskIds: [1],
      resourceIds: [1],
      milestoneIds: [1],
      changeRequestIds: [1],
      refs: [
        'task:1',
        'task:2',
        'task:3',
        'risk:1',
        'resource:1',
        'milestone:1',
        'change_request:1',
      ],
    },
    trimmedDomains: [],
    warnings: [],
    truncated: false,
    limits: { ...TRIZ_CONTEXT_PACK_LIMITS },
    ...overrides,
  }
}

/** 无任何项目事实的上下文包（走通用模板）。 */
function makeEmptyPack(): TrizContextPack {
  const pack = makePack()
  return {
    ...pack,
    domains: {
      tasks: {
        readings: {
          total: 0,
          criticalPathCount: 0,
          overdueCount: 0,
          schedule: { spi: 1, sv: 0, scheduleStatus: 'on_track', hasBaseline: false },
        },
        items: [],
        criticalPathTaskIds: [],
        truncated: false,
      },
    },
    entityWhitelist: {
      taskIds: [],
      riskIds: [],
      resourceIds: [],
      milestoneIds: [],
      changeRequestIds: [],
      refs: [],
    },
  }
}

function allowAll(): TrizContextPermissionChecker {
  return { check: async () => ({ allowed: true }) }
}

function denyTrigger(): TrizContextPermissionChecker {
  return {
    check: async (_user, permission) => ({
      allowed: permission !== AI_TRIGGER,
      reason: permission === AI_TRIGGER ? 'permission_not_granted' : undefined,
    }),
  }
}

interface FakeModelPort {
  port: TrizGalleryPrefillModelPort
  calls: TrizGalleryPrefillGenerationRequest[]
}

function makeModelPort(
  handler: (
    request: TrizGalleryPrefillGenerationRequest,
  ) => Promise<TrizGalleryPrefillGenerationResponse>,
): FakeModelPort {
  const calls: TrizGalleryPrefillGenerationRequest[] = []
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

function modelResponse(rawText: string): TrizGalleryPrefillGenerationResponse {
  return {
    rawText,
    provider: 'fixture-provider',
    model: 'fixture-model',
    totalTokens: 96,
    usingRealAdapter: true,
  }
}

function nineWindowsRequest(
  overrides: Partial<TrizGalleryPrefillRequest> = {},
): TrizGalleryPrefillRequest {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    actor: ACTOR,
    artifactType: 'nine_windows',
    contextPack: makePack(),
    ...overrides,
  }
}

function functionRequest(
  overrides: Partial<TrizGalleryPrefillRequest> = {},
): TrizGalleryPrefillRequest {
  return { ...nineWindowsRequest(), artifactType: 'function_analysis', ...overrides }
}

/** 模型给出的九格（全部引用白名单实体）。 */
function nineWindowsModelJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    cells: TRIZ_NINE_WINDOWS_CELL_ORDER.map((key) => ({
      key,
      text: `模型建议：${key}`,
      contextRefs: ['task:1'],
    })),
    ...overrides,
  })
}

test.group('TRIZ 分馆预填与矩阵投影（W4 4.2）', () => {
  test('模型路径 fixture：path=ai、providerCalls=1、九格取模型文案且引用全过白名单', async ({
    assert,
  }) => {
    const fake = makeModelPort(async () => modelResponse(nineWindowsModelJson()))
    const service = new TrizGalleryPrefillService({
      model: fake.port,
      realAiEnabled: true,
      permissionChecker: allowAll(),
    })

    const draft = (await service.prefetch(nineWindowsRequest())) as TrizNineWindowsPrefillDraft

    assert.equal(draft.path, 'ai')
    assert.equal(draft.modelUsage.providerCalls, 1)
    assert.equal(draft.modelUsage.provider, 'fixture-provider')
    assert.equal(fake.calls.length, 1)
    assert.lengthOf(draft.cells, 9)
    assert.equal(draft.filledCells, 9)
    assert.equal(draft.centerKey, TRIZ_NINE_WINDOWS_CENTER_KEY)
    for (const cell of draft.cells) {
      assert.equal(cell.source, 'model')
      assert.match(cell.text, /^模型建议：/)
      for (const ref of cell.contextRefs) {
        assert.isTrue(isContextRefWhitelisted(makePack(), ref), `引用 ${ref} 必须在白名单内`)
      }
    }
    assert.isTrue(draft.cells.some((cell) => cell.locked))
    assert.isFalse(draft.persisted)
    assert.isTrue(draft.requiresHumanConfirmation)
    // 提示词低敏：只有 kind:id 与读数，不含任何全文
    const prompt = buildTrizGalleryPrefillPrompt(
      'nine_windows',
      makePack(),
      TRIZ_GALLERY_PREFILL_LIMITS,
    )
    assert.include(prompt.userPrompt, 'task:1')
    assert.notInclude(prompt.userPrompt, 'prompt')
  })

  test('默认 fixture（真实模型关闭）：path=rule、providerCalls=0、零 Token、八格以上有内容', async ({
    assert,
  }) => {
    const fake = makeModelPort(async () => modelResponse(nineWindowsModelJson()))
    // 不注入 model 也未开启真实模型 ⇒ 不得触达模型通道
    const service = new TrizGalleryPrefillService({ realAiEnabled: false })
    const draft = (await service.prefetch(nineWindowsRequest())) as TrizNineWindowsPrefillDraft

    assert.equal(draft.path, 'rule')
    assert.equal(draft.modelUsage.providerCalls, 0)
    assert.equal(draft.modelUsage.totalTokens, 0)
    assert.deepEqual(draft.fallbackReasons, ['MODEL_DISABLED'])
    assert.lengthOf(draft.cells, 9)
    assert.isAtLeast(draft.filledCells, 8, '无空白画布：有上下文时至少 8 格有内容')
    assert.equal(fake.calls.length, 0)
    for (const cell of draft.cells) {
      assert.equal(cell.source, 'template')
      assert.isNotEmpty(cell.text)
    }
    // 预填内容确实引用了真实项目实体，且全部在白名单内
    assert.isAtLeast(draft.contextRefs.length, 1)
    for (const ref of draft.contextRefs) {
      assert.isTrue(isContextRefWhitelisted(makePack(), ref))
    }
  })

  test('回退路径逐条：强制模板 / 无 ai:trigger / 通道不可用 / 调用失败 / 超时 / 输出非法', async ({
    assert,
  }) => {
    const forced = new TrizGalleryPrefillService({
      model: makeModelPort(async () => modelResponse(nineWindowsModelJson())).port,
      realAiEnabled: true,
      permissionChecker: allowAll(),
    })
    const forcedDraft = await forced.prefetch(nineWindowsRequest({ forceTemplatePath: true }))
    assert.equal(forcedDraft.path, 'rule')
    assert.equal(forcedDraft.modelUsage.providerCalls, 0)
    assert.include(forcedDraft.fallbackReasons, 'MODEL_DISABLED')

    const noTrigger = new TrizGalleryPrefillService({
      model: makeModelPort(async () => modelResponse(nineWindowsModelJson())).port,
      realAiEnabled: true,
      permissionChecker: denyTrigger(),
    })
    const noTriggerDraft = await noTrigger.prefetch(nineWindowsRequest())
    assert.equal(noTriggerDraft.path, 'rule')
    assert.equal(noTriggerDraft.modelUsage.providerCalls, 0)
    assert.include(noTriggerDraft.fallbackReasons, 'NO_AI_TRIGGER')

    const unavailable = new TrizGalleryPrefillService({
      model: null,
      realAiEnabled: true,
      permissionChecker: allowAll(),
    })
    const unavailableDraft = await unavailable.prefetch(nineWindowsRequest())
    assert.equal(unavailableDraft.path, 'rule')
    assert.equal(unavailableDraft.modelUsage.providerCalls, 0)
    assert.include(unavailableDraft.fallbackReasons, 'MODEL_UNAVAILABLE')

    const failing = new TrizGalleryPrefillService({
      model: makeModelPort(async () => {
        throw new Error('boom')
      }).port,
      realAiEnabled: true,
      permissionChecker: allowAll(),
    })
    const failingDraft = await failing.prefetch(nineWindowsRequest())
    assert.equal(failingDraft.path, 'rule')
    assert.equal(failingDraft.modelUsage.providerCalls, 1)
    assert.include(failingDraft.fallbackReasons, 'MODEL_FAILED')

    const timingOut = new TrizGalleryPrefillService({
      model: makeModelPort(async () => {
        const error = new Error('timeout')
        error.name = 'TimeoutError'
        throw error
      }).port,
      realAiEnabled: true,
      permissionChecker: allowAll(),
    })
    const timingOutDraft = await timingOut.prefetch(nineWindowsRequest())
    assert.include(timingOutDraft.fallbackReasons, 'MODEL_TIMEOUT')

    const invalid = new TrizGalleryPrefillService({
      model: makeModelPort(async () => modelResponse('{"cells":[{"key":"not-a-key"}]}')).port,
      realAiEnabled: true,
      permissionChecker: allowAll(),
    })
    const invalidDraft = (await invalid.prefetch(
      nineWindowsRequest(),
    )) as TrizNineWindowsPrefillDraft
    assert.equal(invalidDraft.path, 'rule')
    assert.equal(invalidDraft.modelUsage.providerCalls, 1)
    assert.include(invalidDraft.fallbackReasons, 'MODEL_OUTPUT_INVALID')
    assert.isAtLeast(invalidDraft.filledCells, 8)
  })

  test('白名单拒绝路径：模型编造实体 ⇒ 该格降级通用模板并只记计数（不落正文）', async ({
    assert,
  }) => {
    const fabricated = JSON.stringify({
      cells: TRIZ_NINE_WINDOWS_CELL_ORDER.map((key) => ({
        key,
        text: `模型编造：${key}`,
        contextRefs: ['task:999'],
      })),
    })
    const service = new TrizGalleryPrefillService({
      model: makeModelPort(async () => modelResponse(fabricated)).port,
      realAiEnabled: true,
      permissionChecker: allowAll(),
    })

    const draft = (await service.prefetch(nineWindowsRequest())) as TrizNineWindowsPrefillDraft

    assert.include(draft.qualityFlags, 'CONTEXT_REFS_REJECTED')
    assert.isEmpty(draft.contextRefs)
    for (const cell of draft.cells) {
      assert.equal(cell.source, 'generic-template')
      assert.equal(cell.text, genericNineWindowsCell(cell.key))
      assert.notInclude(cell.text, '模型编造')
      assert.isEmpty(cell.contextRefs)
    }

    // 功能分析：编造实体的节点整颗丢弃，且不出现该 ID
    const fabricatedGraph = JSON.stringify({
      nodes: [
        { id: 'n1', kind: 'task', label: '编造任务', contextRef: 'task:999' },
        { id: 'n2', kind: 'risk', label: '真实风险', contextRef: 'risk:1' },
      ],
      edges: [{ from: 'n1', to: 'n2', edgeType: 'harmful' }],
    })
    const graphService = new TrizGalleryPrefillService({
      model: makeModelPort(async () => modelResponse(fabricatedGraph)).port,
      realAiEnabled: true,
      permissionChecker: allowAll(),
    })
    const graphDraft = (await graphService.prefetch(
      functionRequest(),
    )) as TrizFunctionAnalysisPrefillDraft

    assert.include(graphDraft.qualityFlags, 'CONTEXT_REFS_REJECTED')
    assert.lengthOf(graphDraft.nodes, 1)
    assert.equal(graphDraft.nodes[0].id, 'n2')
    assert.deepEqual(graphDraft.nodes[0].contextRef, 'risk:1')
    assert.isEmpty(graphDraft.edges, '被丢弃节点的边一并丢弃')
    assert.notInclude(JSON.stringify(graphDraft), 'task:999')
  })

  test('功能分析确定性初始图：四类功能边齐备且节点全部绑定白名单实体', async ({ assert }) => {
    const service = new TrizGalleryPrefillService({ realAiEnabled: false })
    const draft = (await service.prefetch(functionRequest())) as TrizFunctionAnalysisPrefillDraft

    assert.equal(draft.path, 'rule')
    assert.equal(draft.modelUsage.providerCalls, 0)
    assert.isAtLeast(draft.nodes.length, 2)
    assert.equal(draft.nodes[0].kind, 'system')

    const edgeTypes = new Set(draft.edges.map((edge) => edge.edgeType))
    assert.deepEqual(
      [...edgeTypes].sort(),
      ['excessive', 'harmful', 'insufficient', 'useful'],
      '四类功能边（有用 / 有害 / 不足 / 过度）齐备',
    )
    for (const node of draft.nodes) {
      if (!node.contextRef) continue
      assert.isTrue(isContextRefWhitelisted(makePack(), node.contextRef))
    }
    assert.isAtLeast(draft.problemCandidates.length, 1)
    assert.isFalse(draft.persisted)
    assert.isTrue(draft.requiresHumanConfirmation)
  })

  test('空上下文：走通用模板（不留空白格，也不冒充项目事实）', async ({ assert }) => {
    const service = new TrizGalleryPrefillService({ realAiEnabled: false })
    const draft = (await service.prefetch(
      nineWindowsRequest({ contextPack: makeEmptyPack() }),
    )) as TrizNineWindowsPrefillDraft

    assert.include(draft.qualityFlags, 'CONTEXT_EMPTY')
    assert.equal(draft.path, 'rule')
    assert.lengthOf(draft.cells, 9)
    for (const cell of draft.cells) {
      assert.equal(cell.text, genericNineWindowsCell(cell.key))
      assert.equal(cell.source, 'template')
      assert.isEmpty(cell.contextRefs)
    }
    assert.isEmpty(draft.contextRefs)
  })

  test('上下文包与请求组织 / 项目不一致时 fail-closed（不静默串租户）', async ({ assert }) => {
    const service = new TrizGalleryPrefillService({ realAiEnabled: false })
    let thrown: unknown = null
    try {
      await service.prefetch(nineWindowsRequest({ projectId: PROJECT_ID + 1 }))
    } catch (error) {
      thrown = error
    }
    assert.isNotNull(thrown, '上下文包与请求项目不一致时必须拒绝')
    assert.equal((thrown as { code?: string }).code, 'VALIDATION_ERROR')
    assert.isTrue(thrown instanceof ValidationException)
  })

  test('矩阵投影：命中参数对给出原则与来源，空单元中性提示', async ({ assert }) => {
    // spec 场景 1：#39 生产率 × #27 可靠性
    const hit = projectMatrixPrinciples(39, 27)
    assert.isTrue(hit.matched)
    assert.isFalse(hit.empty)
    assert.isNull(hit.hint)
    assert.equal(hit.improving?.number, 39)
    assert.equal(hit.worsening?.number, 27)
    assert.isNotEmpty(hit.improving?.nameZh)
    assert.isAtLeast(hit.mappings.length, 1)
    assert.isAtLeast(hit.principles.length, 1)
    for (const principle of hit.principles) {
      assert.isNotEmpty(principle.definition)
      assert.isNotEmpty(principle.pmInterpretation)
    }
    for (const mapping of hit.mappings) {
      assert.isNotEmpty(mapping.source, 'RL-10：命中映射必须带来源章节标注')
      assert.isAtLeast(mapping.principleNumbers.length, 1)
      assert.isAtLeast(mapping.recommendations.length, 1)
    }
    assert.equal(hit.knowledgePack.principleCount, 40)
    assert.equal(hit.knowledgePack.parameterCount, 39)

    // 未收录的参数对：中性空结果（不抛错、不显示为错误）
    const empty = projectMatrixPrinciples(1, 2)
    assert.isFalse(empty.matched)
    assert.isTrue(empty.empty)
    assert.equal(empty.hint, TRIZ_GALLERY_MATRIX_EMPTY_HINT)
    assert.isEmpty(empty.mappings)
    assert.isEmpty(empty.principles)
    assert.equal(empty.improving?.number, 1)
    assert.equal(empty.worsening?.number, 2)

    // 同一输入两次调用结果完全一致（确定性）
    assert.deepEqual(projectMatrixPrinciples(39, 27), projectMatrixPrinciples(39, 27))
  })

  test('矩阵参数边界：0 / 40 / 非整数 → 中性空结果而非抛错', async ({ assert }) => {
    for (const [improving, worsening] of [
      [0, 27],
      [40, 27],
      [1.5, 27],
      [27, 0],
      [27, 40],
      [Number.NaN, 27],
    ]) {
      const result = projectMatrixPrinciples(improving, worsening)
      assert.isFalse(result.matched, `${improving} × ${worsening} 应为中性空结果`)
      assert.isTrue(result.empty)
      assert.equal(result.hint, TRIZ_GALLERY_MATRIX_EMPTY_HINT)
    }

    // 越界一侧为 null，另一侧照常投影（不把中立结果伪装成错误）
    const outOfRange = projectMatrixPrinciples(0, 27)
    assert.isNull(outOfRange.improving)
    assert.equal(outOfRange.worsening?.number, 27)
  })

  test('强 Schema：非 JSON / 缺字段 / 边类型越界一律判非法', ({ assert }) => {
    assert.isFalse(parseTrizGalleryPrefillModelOutput('nine_windows', 'not json').ok)
    assert.isTrue(parseTrizGalleryPrefillModelOutput('nine_windows', '{"cells":[]}').ok)
    assert.isFalse(parseTrizGalleryPrefillModelOutput('nine_windows', '{"cells":[{"key":"x"}]}').ok)
    assert.isFalse(
      parseTrizGalleryPrefillModelOutput(
        'function_analysis',
        '{"nodes":[{"id":"a","kind":"task","label":"x"}],"edges":[{"from":"a","to":"a","edgeType":"unknown"}]}',
      ).ok,
    )
    assert.isTrue(
      parseTrizGalleryPrefillModelOutput(
        'function_analysis',
        '{"nodes":[{"id":"a","kind":"task","label":"x"}],"edges":[]}',
      ).ok,
    )
  })

  test('默认值只允许收紧，且预填服务不落库（静态 + 运行时双断言）', async ({ assert }) => {
    const tightened = resolveTrizGalleryPrefillLimits({
      maxNodes: 3,
      maxEdges: 2,
      maxOutputTokens: 1_000_000,
    })
    assert.equal(tightened.maxNodes, 3)
    assert.equal(tightened.maxEdges, 2)
    assert.equal(tightened.maxOutputTokens, TRIZ_GALLERY_PREFILL_LIMITS.maxOutputTokens)

    const source = readSource(SERVICE_RELATIVE_PATH)
    for (const [pattern, label] of WRITE_PATTERNS) {
      assert.isFalse(pattern.test(source), `预填服务不得出现${label}（只产草案，不落库）`)
    }

    const service = new TrizGalleryPrefillService({ realAiEnabled: false })
    const draft = await service.prefetch(nineWindowsRequest())
    assert.isFalse(draft.persisted)
    assert.isTrue(draft.requiresHumanConfirmation)
  })
})
