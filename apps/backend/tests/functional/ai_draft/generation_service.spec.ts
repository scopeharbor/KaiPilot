import { test } from '@japa/runner'
import type { ConfirmedProjectContext } from '@aiproj/types'
import type { ProjectDraftGenerationStage, ProjectDraftPipelineCheckpoint } from '@aiproj/types'
import { AIGateway } from '#services/ai_m0/gateway'
import { MockAdapter } from '#services/ai_m0/mock_adapter'
import type { ResolvedAdapter } from '#services/ai_m0/resolver'
import { ProjectDraftGenerationService } from '#services/ai_draft/generation_service'
import { fixtureDraft } from '#services/ai_draft/fixtures'
import { validateProjectDraft } from '#services/ai_draft/schema'
import {
  correctInternalTicketDraft,
  INTERNAL_TICKET_QUALITY_CONTEXT,
  wrongOaDraftForTicketContext,
} from '#services/ai_draft/quality_fixtures'
import Project from '#models/project'
import Task from '#models/task'
import WbsNode from '#models/wbs_node'
import TaskDependency from '#models/task_dependency'
import Milestone from '#models/milestone'
import { createOrganization, createUser, useAuthDatabase } from '../auth/_helpers.js'
import { AUXILIARY_UNDERSTANDING, withAuxiliary } from './_auxiliary_calls.js'
import { buildDraftCalendar } from '#services/ai_draft/cn_calendar'
import { isWorkingDay, parseIsoDate } from '#services/gantt_working_calendar'
import type { DraftRawTextProvider } from '#services/ai_draft/generation_service'

/**
 * 本文件的用例只断言五阶段的行为：理解层与质量闭环的辅助调用由 withAuxiliary 统一应答，
 * 调用计数、阶段序列与修复断言保持原意。group.setup 返回的清理函数负责还原。
 */
function answerAuxiliaryCalls() {
  const original = ProjectDraftGenerationService.prototype.generate
  ProjectDraftGenerationService.prototype.generate = function (options) {
    return original.call(
      this,
      options.rawTextProvider
        ? { ...options, rawTextProvider: withAuxiliary(options.rawTextProvider) }
        : options,
    )
  }
  return () => {
    ProjectDraftGenerationService.prototype.generate = original
  }
}

function makeContext(overrides: Partial<ConfirmedProjectContext> = {}): ConfirmedProjectContext {
  const base: ConfirmedProjectContext = {
    schemaVersion: '1.0',
    rawInput: '开发一个面向运营人员的内部审批系统，减少重复录入。',
    parsedIntent: {
      schemaVersion: '1.0',
      projectType: 'software',
      projectName: null,
      objectives: [],
      deliverables: [],
      timeline: { startDate: null, deadline: null, durationDays: null },
      constraints: [],
      entities: [],
      overallConfidence: 0.72,
    },
    resolvedFields: {},
    assumptions: {},
    unresolvedCriticalFields: [],
    unansweredOptionalFields: [],
  }
  return { ...base, ...overrides }
}

function makeResolved(overrides: Partial<ResolvedAdapter> = {}): ResolvedAdapter {
  return {
    gateway: new AIGateway(new MockAdapter()),
    provider: 'mock',
    model: 'mock-deterministic-v1',
    usingRealAdapter: false,
    source: 'mock',
    ...overrides,
  }
}

function stagedOutput(stage: ProjectDraftGenerationStage): unknown {
  const draft = correctInternalTicketDraft()
  if (stage === 'charter_scope') return { charter: draft.charter }
  if (stage === 'wbs_tasks') return { wbs: draft.wbs, tasks: draft.tasks }
  if (stage === 'schedule_dependencies') {
    return { dependencies: draft.dependencies, ganttPreview: draft.ganttPreview }
  }
  if (stage === 'resources_risks_acceptance') {
    return {
      acceptanceCriteria: draft.acceptanceCriteria,
      resourceHints: draft.resourceHints,
      riskHints: draft.riskHints,
      milestoneHints: draft.milestoneHints,
    }
  }
  return draft
}

test.group('AI 草案生成引擎', (group) => {
  group.setup(answerAuxiliaryCalls)

  test('显式事实不被覆盖：项目名/目标/开始日期以 explicit 进入草案', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const context = makeContext({
      parsedIntent: {
        ...makeContext().parsedIntent,
        projectName: '智能审批中台',
        objectives: ['减少重复录入', '打通审批与通知'],
      },
      resolvedFields: {
        startDate: {
          value: '2026-10-01',
          marker: {
            source: 'explicit',
            reason: '用户明确指定',
            confidence: 1,
            needsConfirmation: false,
          },
        },
      },
    })

    const result = await service.generate({ context, resolved: makeResolved() })

    assert.equal(result.status, 'completed')
    const draft = result.draft!
    assert.equal(draft.charter.title.value, '智能审批中台')
    assert.equal(draft.charter.title.marker.source, 'explicit')
    assert.isFalse(draft.charter.title.marker.needsConfirmation)
    assert.deepEqual(draft.charter.objectives.value, ['减少重复录入', '打通审批与通知'])
    assert.equal(draft.charter.objectives.marker.source, 'explicit')
    assert.equal(draft.charter.startDate.value, '2026-10-01')
    assert.equal(draft.charter.startDate.marker.source, 'explicit')
    assert.isFalse(draft.charter.startDate.marker.needsConfirmation)
    // 显式高影响字段（needsConfirmation=false）仍必须通过权威校验（豁免规则生效）。
    assert.isTrue(validateProjectDraft(draft).ok)
  })

  test('默认假设继承：assumptions.startDate 以 default 进入且需确认', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const context = makeContext({
      assumptions: {
        startDate: {
          value: '2026-09-15',
          marker: {
            source: 'default',
            reason: '默认下月初启动',
            confidence: 0.5,
            needsConfirmation: true,
          },
        },
      },
    })

    const result = await service.generate({ context, resolved: makeResolved() })

    const draft = result.draft!
    assert.equal(draft.charter.startDate.value, '2026-09-15')
    assert.equal(draft.charter.startDate.marker.source, 'default')
    assert.isTrue(draft.charter.startDate.marker.needsConfirmation)
    assert.isTrue(validateProjectDraft(draft).ok)
  })

  test('结构化策略按连接能力降级 native > tool > prompt', ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    assert.equal(
      service.resolveStrategy(
        makeResolved({ source: 'user', capabilities: { supportsStrictSchema: true } }),
      ),
      'native',
    )
    assert.equal(
      service.resolveStrategy(
        makeResolved({
          source: 'user',
          capabilities: { supportsStrictSchema: false, supportsToolCalling: true },
        }),
      ),
      'tool',
    )
    assert.equal(
      service.resolveStrategy(
        makeResolved({
          source: 'user',
          capabilities: { supportsStrictSchema: false, supportsToolCalling: false },
        }),
      ),
      'prompt',
    )
    assert.equal(service.resolveStrategy(makeResolved({ source: 'mock' })), 'prompt')
    assert.equal(service.resolveStrategy(makeResolved({ source: 'fallback' })), 'native')
  })

  test('弱结构化降级：meta 如实标注 prompt 策略与 fallback', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const weak = makeResolved({
      source: 'user',
      usingRealAdapter: true,
      provider: 'openai-compatible',
      model: 'local-llama',
      capabilities: {
        supportsStrictSchema: false,
        supportsStreamingTool: false,
        supportsToolCalling: false,
      },
    })
    const result = await service.generate({ context: makeContext(), resolved: weak })
    assert.equal(result.meta.structuredStrategy, 'prompt')
    // 确定性引擎路径：内容非真实模型输出，如实标注 fallback。
    assert.isTrue(result.meta.fallbackUsed)
    assert.isFalse(result.meta.usingRealAdapter)
    assert.equal(result.meta.provider, 'openai-compatible')
    assert.equal(result.meta.confirmability?.status, 'review_blocked')
  })

  test('确定性 fixture 与模型契约 fallback 都不可确认', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const deterministic = await service.generate({
      context: makeContext(),
      resolved: makeResolved(),
    })
    assert.equal(deterministic.meta.confirmability?.status, 'review_blocked')

    const fallback = await service.generate({
      context: makeContext(),
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async () =>
        JSON.stringify({ schemaVersion: '1.0', projectType: 'software' }),
      maxRetries: 0,
    })
    assert.equal(fallback.meta.confirmability?.status, 'review_blocked')
    assert.isTrue(fallback.meta.fallbackUsed)
  })

  test('模型路径一次通过判 strict', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const valid = JSON.stringify(fixtureDraft('software'))
    const result = await service.generate({
      context: makeContext(),
      resolved: makeResolved({
        source: 'user',
        usingRealAdapter: true,
        provider: 'openai',
        model: 'gpt',
      }),
      rawTextProvider: async () => valid,
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.consistency, 'strict')
    assert.equal(result.meta.consistency, 'strict')
    assert.isTrue(result.meta.usingRealAdapter)
    assert.isFalse(result.meta.fallbackUsed)
    assert.equal(result.retries, 0)
  })

  test('provenance 区分请求模型、响应模型与实际结构化策略', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const result = await service.generate({
      context: makeContext(),
      resolved: makeResolved({
        source: 'user',
        usingRealAdapter: true,
        provider: 'openai-compatible',
        model: 'requested-model',
      }),
      rawTextProvider: async () => ({
        rawText: JSON.stringify(fixtureDraft('software')),
        responseModel: 'provider-response-model',
        effectiveStrategy: 'prompt',
      }),
    })
    assert.equal(result.meta.provenance?.requestedModel, 'requested-model')
    assert.equal(result.meta.provenance?.responseModel, 'provider-response-model')
    assert.equal(result.meta.provenance?.effectiveStrategy, 'prompt')
  })

  test('资源阶段后按团队名册对齐人数、治理文档经归一化保留，名册与日历进入排期提示', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    const prompts = new Map<string, string>()
    const context = {
      ...INTERNAL_TICKET_QUALITY_CONTEXT,
      rawInput:
        '为运营团队建设内部工单系统，团队：运营专员 5、后端开发 3、测试 2。' +
        '国庆期间冻结生产变更。',
    }
    const result = await service.generate({
      context,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      rawTextProvider: async ({ stage, prompt }) => {
        prompts.set(stage!, prompt.systemPrompt + prompt.userPrompt)
        const output = stagedOutput(stage!) as Record<string, unknown>
        if (stage === 'resources_risks_acceptance') {
          return JSON.stringify({
            ...output,
            governance: {
              raci: [
                {
                  activity: '工单受理上线',
                  responsible: '后端开发、测试',
                  accountable: '运营专员',
                  consulted: [],
                  informed: ['运营专员'],
                },
              ],
              qualityGates: [
                {
                  name: 'UAT',
                  entryCriteria: ['SIT 严重缺陷清零'],
                  exitCriteria: ['用例通过率 ≥ 98%'],
                },
              ],
              releaseWindows: [],
            },
          })
        }
        return JSON.stringify(output)
      },
    })
    assert.equal(result.status, 'completed', JSON.stringify(result.meta.stages))
    const wbsPrompt = prompts.get('wbs_tasks') ?? ''
    assert.include(wbsPrompt, '【团队名册】')
    assert.include(wbsPrompt, '后端开发')
    assert.include(prompts.get('resources_risks_acceptance') ?? '', 'workCalendar')
    const hints = result.draft!.resourceHints.map((hint) => [hint.role.value, hint.headcount.value])
    assert.deepInclude(hints, ['后端开发', 3])
    assert.deepInclude(hints, ['测试', 2])
    assert.include(result.meta.appliedFixes, 'resource_plan_applied')
    assert.deepEqual(result.draft!.governance?.raci[0].responsible, ['后端开发', '测试'])
    assert.equal(result.draft!.governance?.qualityGates[0].name, 'UAT')
  })

  test('生产五阶段按顺序调用、上下文逐步开放并形成 checkpoint artifact', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const stages: ProjectDraftGenerationStage[] = []
    const prompts: string[] = []
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      rawTextProvider: async ({ stage, prompt }) => {
        stages.push(stage!)
        prompts.push(prompt.userPrompt)
        return JSON.stringify(stagedOutput(stage!))
      },
    })

    // 复核阶段由质量闭环完成（辅助调用），不再发起整份重写的模型调用。
    assert.deepEqual(stages, [
      'charter_scope',
      'wbs_tasks',
      'schedule_dependencies',
      'resources_risks_acceptance',
    ])
    assert.equal(result.status, 'completed')
    assert.equal(result.meta.confirmability?.status, 'confirmable')
    assert.lengthOf(result.meta.stages ?? [], 5)
    assert.isTrue(result.meta.stages?.every((stage) => stage.artifactHash !== null) ?? false)
    assert.notInclude(prompts.join('\n'), INTERNAL_TICKET_QUALITY_CONTEXT.rawInput)
    assert.notInclude(prompts[0]!, '"tasks"')
    // 上下文隔离：排期阶段只拿到任务索引（id|WBS|名称|工期|角色|产出），不带完整任务对象与 Marked 包装。
    assert.include(prompts[2]!, '"taskIndex"')
    assert.notInclude(prompts[2]!, '"marker"')
    assert.isTrue((result.meta.stages ?? []).every((stage) => stage.allowedTools.length <= 2))
  })

  test('阶段失败只做一次定向修复，成功后继续而不退回通用蓝图', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    let calls = 0
    const prompts: string[] = []
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage, prompt }) => {
        calls += 1
        prompts.push(prompt.userPrompt)
        if (calls === 1) return 'not-json'
        return JSON.stringify(stagedOutput(stage!))
      },
    })

    assert.equal(result.status, 'completed')
    assert.equal(calls, 5)
    assert.lengthOf(result.meta.repairs ?? [], 1)
    assert.include(prompts[1]!, '定向修复信封')
    assert.equal(result.meta.stages?.[0]?.attemptCount, 2)
    assert.notInclude(
      result.meta.appliedFixes,
      'fallback_to_blueprint_after_model_contract_failure',
    )
  })

  test('进度 callback 与无 callback 产生完全相同的权威草案结果', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const valid = JSON.stringify(fixtureDraft('software'))
    const resolved = makeResolved({ source: 'user', usingRealAdapter: true })
    const withoutProgress = await service.generate({
      context: makeContext(),
      resolved,
      rawTextProvider: async () => valid,
    })
    const phases: string[] = []
    const chunks: string[] = []
    const withProgress = await service.generate({
      context: makeContext(),
      resolved,
      rawTextProvider: async ({ onChunk }) => {
        const split = Math.floor(valid.length / 2)
        for (const chunk of [valid.slice(0, split), valid.slice(split)]) {
          onChunk?.(chunk)
        }
        return valid
      },
      onChunk: (chunk) => chunks.push(chunk),
      onPhase: (phase) => phases.push(phase),
    })

    assert.deepEqual(withProgress, withoutProgress)
    assert.equal(chunks.join(''), valid)
    assert.includeMembers(phases, [
      'adapter_ready',
      'first_token',
      'receiving',
      'parsing',
      'validating',
    ])
  })

  test('进度 callback 不会把非法模型输出变成可确认草案', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const phases: string[] = []
    const result = await service.generate({
      context: makeContext(),
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async ({ onChunk }) => {
        onChunk?.('not-json')
        return 'not-json'
      },
      maxRetries: 0,
      onPhase: (phase) => phases.push(phase),
    })

    assert.equal(result.status, 'failed')
    assert.isNull(result.draft)
    assert.equal(result.consistency, 'failed')
    assert.include(phases, 'first_token')
    assert.include(phases, 'parsing')
  })

  test('模型路径经轻量修复通过判 repairable', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const fenced = '```json\n' + JSON.stringify(fixtureDraft('software')) + '\n```'
    const result = await service.generate({
      context: makeContext(),
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async () => fenced,
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.consistency, 'repairable')
    assert.isAbove(result.meta.appliedFixes.length, 0)
  })

  test('recovers valid draft JSON when the model adds prose before the object', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    const prefixed = '下面是项目草案 JSON：\n' + JSON.stringify(fixtureDraft('software'))
    const result = await service.generate({
      context: makeContext(),
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async () => prefixed,
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.consistency, 'repairable')
    assert.include(result.meta.appliedFixes, 'trim_before_first_brace')
  })

  test('模型路径重试耗尽仍非法：判 failed 且不可确认', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    let calls = 0
    const result = await service.generate({
      context: makeContext(),
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async () => {
        calls += 1
        return '这不是 JSON'
      },
      maxRetries: 1,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'MODEL_RESPONSE_JSON_INVALID')
    assert.equal(result.stage, 'charter_scope')
    assert.equal(result.reasonCode, 'MODEL_RESPONSE_JSON_INVALID')
    assert.equal(result.meta.failure?.stage, 'charter_scope')
    assert.equal(result.meta.failure?.reasonCode, 'MODEL_RESPONSE_JSON_INVALID')
    assert.equal(result.retries, 1)
    assert.equal(calls, 2, '应尝试初次 + 1 次重试')
    assert.equal(result.meta.confirmability?.status, 'failed')
    assert.lengthOf(result.meta.repairs ?? [], 1)
  })

  test('语义失败的第二次请求携带脱敏 RepairEnvelope 且能修复错误 OA 领域', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const prompts: string[] = []
    const outputs = [wrongOaDraftForTicketContext(), correctInternalTicketDraft()]
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async ({ prompt, attempt }) => {
        prompts.push(prompt.userPrompt)
        return JSON.stringify(outputs[attempt])
      },
      maxRetries: 1,
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.meta.confirmability?.status, 'confirmable')
    assert.equal(prompts.length, 2)
    assert.notEqual(prompts[0], prompts[1])
    assert.include(prompts[1]!, '定向修复信封')
    assert.notInclude(prompts.join('\n'), INTERNAL_TICKET_QUALITY_CONTEXT.rawInput)
    assert.notMatch(prompts.join('\n'), /sk-[a-z0-9]{12,}|authorization/i)
    assert.lengthOf(result.meta.repairs ?? [], 1)
    assert.notEqual(result.meta.repairs?.[0]?.requestFingerprint, '')
  })

  test('模型返回可解析但结构不完整：后端补齐为 repairable 草案', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const result = await service.generate({
      context: makeContext(),
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async () =>
        JSON.stringify({ schemaVersion: '1.0', projectType: 'software' }),
      maxRetries: 0,
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.consistency, 'repairable')
    assert.equal(result.meta.fallbackUsed, true)
    assert.include(result.meta.appliedFixes, 'fallback_to_blueprint_after_model_contract_failure')
    assert.equal(result.meta.confirmability?.status, 'review_blocked')
    assert.isTrue(validateProjectDraft(result.draft).ok)
  })

  test('阶段提示词携带输出结构说明与 AIMarker 契约（防止模型自造结构）', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const systemPrompts: string[] = []
    const stages: string[] = []
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      rawTextProvider: async ({ stage, prompt }) => {
        stages.push(stage!)
        systemPrompts.push(prompt.systemPrompt)
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(result.status, 'completed')
    const charterPrompt = systemPrompts[stages.indexOf('charter_scope')]!
    assert.include(charterPrompt, 'AIMarker 契约')
    assert.include(charterPrompt, '本阶段输出')
    assert.include(charterPrompt, '输出示例')
    const wbsPrompt = systemPrompts[stages.indexOf('wbs_tasks')]!
    assert.include(wbsPrompt, 'wbsNodeId')
    assert.include(wbsPrompt, 'isLeaf')
    // 复核阶段不再让模型整份重写（改为质量闭环的批判 / 单点修复），不应再出现复核阶段的模型调用。
    assert.notInclude(stages, 'reconcile_review')
    assert.include(wbsPrompt, '任务可执行标准')
  })

  test('阶段产物结构不合法：本阶段就地定向修复且修复提示携带失败明细', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const repairPrompts: string[] = []
    let resourcesCalls = 0
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage, prompt }) => {
        if (prompt.userPrompt.includes('定向修复信封')) repairPrompts.push(prompt.userPrompt)
        if (stage === 'resources_risks_acceptance') {
          resourcesCalls += 1
          if (resourcesCalls === 1) {
            // 实测中模型的典型错误：把对象数组输出成字符串数组
            return JSON.stringify({
              acceptanceCriteria: ['直接用字符串而不是对象'],
              resourceHints: [],
              riskHints: [],
              milestoneHints: [],
            })
          }
        }
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(result.status, 'completed')
    assert.equal(resourcesCalls, 2)
    assert.lengthOf(result.meta.repairs ?? [], 1)
    assert.lengthOf(repairPrompts, 1)
    assert.include(repairPrompts[0]!, '上次校验失败明细')
    assert.include(repairPrompts[0]!, 'acceptanceCriteria[0]')
    const artifact = result.meta.stages?.find((s) => s.stage === 'resources_risks_acceptance')
    assert.equal(artifact?.attemptCount, 2)
  })

  test('不同阶段各自拥有独立修复预算：两处阶段失败分别修复后完成', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const failedOnce = new Set<string>()
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage }) => {
        if (stage === 'charter_scope' && !failedOnce.has(stage)) {
          failedOnce.add(stage)
          return 'not-json'
        }
        if (stage === 'wbs_tasks' && !failedOnce.has(stage)) {
          failedOnce.add(stage)
          const good = stagedOutput(stage) as {
            wbs: unknown
            tasks: Array<Record<string, unknown>>
          }
          return JSON.stringify({
            wbs: good.wbs,
            tasks: good.tasks.map((task) => ({ ...task, wbsNodeId: 'wbs-不存在' })),
          })
        }
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(result.status, 'completed')
    assert.lengthOf(result.meta.repairs ?? [], 2)
    assert.equal(result.meta.stages?.find((s) => s.stage === 'charter_scope')?.attemptCount, 2)
    assert.equal(result.meta.stages?.find((s) => s.stage === 'wbs_tasks')?.attemptCount, 2)
    assert.isTrue(validateProjectDraft(result.draft).ok)
  })

  test('质量闭环：执行视角的批判意见经单点修复落到任务，修复后仍可确认', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const qualityPrompts: string[] = []
    let firstTaskId = ''
    const provider: DraftRawTextProvider = async ({ stage, promptName, prompt }) => {
      if (promptName?.startsWith('draft.understanding')) {
        return JSON.stringify(AUXILIARY_UNDERSTANDING)
      }
      if (promptName === 'draft.quality.critic') {
        qualityPrompts.push(prompt.userPrompt)
        return JSON.stringify({
          findings: [
            { taskId: firstTaskId, problem: '缺少完成标准', suggestion: '补充可验证的完成标准' },
          ],
        })
      }
      if (promptName === 'draft.quality.repair') {
        qualityPrompts.push(prompt.userPrompt)
        return JSON.stringify({
          ops: [
            {
              op: 'update',
              taskId: firstTaskId,
              set: {
                execution: {
                  purpose: '明确需求边界，避免返工',
                  inputs: ['项目章程'],
                  outputs: ['需求规格说明书'],
                  doneCriteria: ['需求评审通过'],
                  steps: ['访谈', '整理', '评审'],
                },
              },
            },
          ],
          unresolved: [{ taskId: null, reason: '上线窗口需要业务方决定' }],
        })
      }
      const output = stagedOutput(stage!) as { tasks?: Array<{ id: string }> }
      if (stage === 'wbs_tasks') firstTaskId = output.tasks?.[0]?.id ?? ''
      return JSON.stringify(output)
    }
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      rawTextProvider: Object.assign(provider, { handlesAuxiliary: true }),
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.meta.confirmability?.status, 'confirmable')
    assert.isTrue(validateProjectDraft(result.draft).ok)
    const repaired = result.draft!.tasks.find((task) => task.id === firstTaskId)
    assert.deepEqual(repaired?.execution?.outputs, ['需求规格说明书'])
    assert.isAtLeast(result.meta.qualityLoop?.repairedTasks ?? 0, 1)
    assert.isTrue(
      (result.meta.reviewItems ?? []).some((item) => item.detail === '上线窗口需要业务方决定'),
      '修不掉、需要人决定的事进入待确认清单',
    )
    // 上下文隔离：每次批判 / 修复只带主干记忆与本分支任务，不带用户原话。
    assert.isTrue(qualityPrompts.length > 0)
    assert.isTrue(qualityPrompts.every((text) => text.includes('"spine"')))
    assert.notInclude(qualityPrompts.join('\n'), INTERNAL_TICKET_QUALITY_CONTEXT.rawInput)
    assert.isTrue((result.meta.contextUsage ?? []).some((usage) => usage.call === 'quality.repair'))
  })

  test('拆解层：按确认的能力逐项拆工作包（多候选 + 评审），WBS 由程序构建且任务可追溯', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    const candidatePrompts: string[] = []
    let judgeCalls = 0
    const provider: DraftRawTextProvider = async ({ stage, promptName, prompt }) => {
      if (promptName === 'draft.decompose.candidate') {
        candidatePrompts.push(prompt.userPrompt)
        const capability = (JSON.parse(prompt.userPrompt) as { capability: { name: string } })
          .capability.name
        return JSON.stringify({
          workPackages: [
            {
              key: 'L1',
              name: `${capability}方案设计`,
              deliverable: '设计说明',
              doneDefinition: '评审通过',
              dependsOn: [],
              effortDays: 4,
            },
            {
              key: 'L2',
              name: `${capability}实现`,
              deliverable: '可用功能',
              doneDefinition: '测试通过',
              dependsOn: ['L1'],
              effortDays: 8,
            },
          ],
        })
      }
      if (promptName === 'draft.decompose.judge') {
        judgeCalls += 1
        const payload = JSON.parse(prompt.userPrompt) as { candidateA: unknown[] }
        return JSON.stringify({ workPackages: payload.candidateA, verdict: '候选 A 交付物更具体' })
      }
      if (promptName?.startsWith('draft.quality.')) {
        return JSON.stringify(
          promptName === 'draft.quality.critic' ? { findings: [] } : { ops: [] },
        )
      }
      if (promptName === 'draft.wbs_tasks.skeleton') throw new Error('不应再调用模型生成骨架')
      if (promptName === 'draft.wbs_tasks.branch') {
        const input = JSON.parse(prompt.userPrompt) as {
          targetLeaves: Array<{ id: string; name: string; deliverable?: string }>
        }
        assert.isTrue(input.targetLeaves.every((leaf) => typeof leaf.deliverable === 'string'))
        return JSON.stringify({
          tasks: input.targetLeaves.map((leaf, index) => ({
            id: `task-${index + 1}`,
            wbsNodeId: leaf.id,
            name: `完成${leaf.name}`,
            description: `产出${leaf.deliverable}`,
            status: 'not_started',
            durationDays: 3,
            assigneeHint: '后端开发',
          })),
        })
      }
      if (stage === 'schedule_dependencies') return JSON.stringify({ dependencies: [] })
      if (stage === 'resources_risks_acceptance') {
        const output = stagedOutput(stage) as {
          acceptanceCriteria: Array<{ linkedTaskId: string | null }>
          milestoneHints: Array<{ linkedTaskIds: string[] }>
        }
        output.acceptanceCriteria.forEach((item) => (item.linkedTaskId = null))
        output.milestoneHints.forEach((item) => (item.linkedTaskIds = []))
        return JSON.stringify(output)
      }
      return JSON.stringify(stagedOutput(stage!))
    }
    const result = await service.generate({
      context: {
        ...INTERNAL_TICKET_QUALITY_CONTEXT,
        planUnderstanding: {
          ...AUXILIARY_UNDERSTANDING,
          version: '1.0',
          confirmedByUser: true,
          capabilities: [
            {
              id: 'cap-1',
              name: '工单受理',
              purpose: '在线受理',
              deliverables: ['受理功能'],
              dependsOn: [],
            },
            {
              id: 'cap-2',
              name: '处理时效看板',
              purpose: '可视化',
              deliverables: ['看板'],
              dependsOn: ['cap-1'],
            },
          ],
        },
      },
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      rawTextProvider: Object.assign(provider, { handlesAuxiliary: true }),
    })
    assert.equal(result.status, 'completed', JSON.stringify(result.errors?.slice(0, 3)))
    // 每项能力 2 份候选 + 1 次评审；候选调用只带主干记忆与本能力，不带用户原话。
    assert.lengthOf(candidatePrompts, 4)
    assert.equal(judgeCalls, 2)
    assert.notInclude(candidatePrompts.join('\n'), INTERNAL_TICKET_QUALITY_CONTEXT.rawInput)
    // WBS：一级 = 能力，二级 = 工作包
    assert.deepEqual(
      result.draft!.wbs.map((node) => node.name.value),
      ['工单受理', '处理时效看板'],
    )
    assert.lengthOf(result.draft!.wbs[0]!.children, 2)
    // 任务可追溯到「能力 › 工作包」
    assert.isTrue(result.draft!.tasks.every((task) => task.trace?.workPackageName))
    assert.equal(result.draft!.tasks[0]!.trace?.capabilityName, '工单受理')
    // 模型拆出的 4 个工作包 + 程序补齐的行业阶段门工作包（样例模型没按阶段门命名）
    const packages = result.meta.decomposition?.workPackages ?? []
    assert.lengthOf(
      packages.filter((pkg) => /方案设计|实现/.test(pkg.name)),
      4,
    )
    assert.isAbove(packages.length, 4)
    assert.equal(result.meta.decomposition?.candidateReviews[0]?.verdict, '候选 A 交付物更具体')
    // 决策库：用户确认的理解、各能力的拆解取舍都有记录
    const decisions = (result.meta.decisions ?? []).map((item) => item.decision).join('\n')
    assert.include(decisions, '按 2 项能力拆解')
    assert.include(decisions, '「工单受理」拆成 2 个工作包')
    assert.include(decisions, '补齐阶段门工作包')
  })

  test('大型草案跳过模型整份复核，直接用已验证的阶段产物聚合完成', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    let reconcileCalls = 0
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage }) => {
        if (stage === 'reconcile_review') {
          reconcileCalls += 1
          return JSON.stringify(stagedOutput(stage))
        }
        const output = stagedOutput(stage!) as { tasks?: Array<{ description: { value: string } }> }
        if (stage === 'wbs_tasks' && output.tasks?.[0]) {
          // 聚合超过 12 万字符：模型整份重写会超出复核阶段的 max_tokens。
          output.tasks[0].description.value = '完成接口联调并输出联调报告。'.repeat(9_000)
        }
        return JSON.stringify(output)
      },
    })
    assert.equal(reconcileCalls, 0, '大型草案不得发起注定被截断的整份复核请求')
    assert.equal(result.status, 'completed')
    assert.isTrue(result.meta.appliedFixes.some((fix) => fix.startsWith('quality_loop:')))
    assert.include(result.meta.appliedFixes, 'reconcile_fallback_to_stage_aggregate')
    assert.equal(result.meta.confirmability?.status, 'confirmable')
    assert.isTrue(validateProjectDraft(result.draft).ok)
    // 主动跳过是设计路径：复核阶段记完成，否则网关会以「阶段产物不完整」阻断确认。
    const reconcile = result.meta.stages?.find((stage) => stage.stage === 'reconcile_review')
    assert.equal(reconcile?.status, 'completed')
    assert.isNotNull(reconcile?.artifactHash ?? null)
    assert.isTrue(result.meta.stages?.every((stage) => stage.status === 'completed'))
  })

  test('大型项目 WBS 阶段拆成骨架 + 分支并行生成，合并结果通过后续全部阶段', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const staged = stagedOutput('wbs_tasks') as {
      wbs: unknown[]
      tasks: Array<{ id: string; wbsNodeId: string; name: { value: string } }>
    }
    const steps: string[] = []
    let singleWbsCalls = 0
    const skeletonPrompts: string[] = []
    const result = await service.generate({
      context: {
        ...INTERNAL_TICKET_QUALITY_CONTEXT,
        resolvedFields: {
          ...INTERNAL_TICKET_QUALITY_CONTEXT.resolvedFields,
          teamSize: {
            value: 80,
            marker: {
              confidence: 1,
              source: 'explicit',
              reason: '用户确认',
              needsConfirmation: false,
            },
          },
        },
      },
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage, prompt }) => {
        if (stage !== 'wbs_tasks') {
          // 合并后任务统一重排为 task-N：后续阶段按任务名把样例里的原 id 映射到新 id。
          // 上下文隔离后阶段只拿到任务索引「id|WBS|名称|…」，按名称把样例原 id 映射到新 id。
          const index = (JSON.parse(prompt.userPrompt) as { taskIndex?: string[] }).taskIndex
          let text = JSON.stringify(stagedOutput(stage!))
          if (index) {
            const idByName = new Map(
              index.map((line) => {
                const [id, , name] = line.split('|')
                return [name!, id!] as const
              }),
            )
            for (const original of staged.tasks) {
              const next = idByName.get(original.name.value)
              if (next) text = text.split(`"${original.id}"`).join(`"__${next}__"`)
            }
            text = text.replace(/"__(task-\d+)__"/g, '"$1"')
          }
          return text
        }
        const input = JSON.parse(prompt.userPrompt) as {
          step?: string
          targetLeaves?: Array<{ id: string }>
        }
        if (!input.step) {
          singleWbsCalls += 1
          return JSON.stringify(staged)
        }
        steps.push(input.step)
        if (input.step === 'wbs_skeleton') {
          skeletonPrompts.push(prompt.systemPrompt)
          return JSON.stringify({ wbs: staged.wbs })
        }
        const leafIds = new Set((input.targetLeaves ?? []).map((leaf) => leaf.id))
        return JSON.stringify({ tasks: staged.tasks.filter((task) => leafIds.has(task.wbsNodeId)) })
      },
    })
    assert.equal(singleWbsCalls, 0, '大型项目不得再走单次超长请求')
    // 样例 WBS 缺少行业必备阶段门：骨架提示先列出必备阶段，缺失时用一次修复预算重写骨架（只重写一次）。
    assert.include(skeletonPrompts[0], '【行业必备阶段】')
    assert.equal(steps.filter((step) => step === 'wbs_skeleton').length, 2)
    assert.include(skeletonPrompts[1], 'STAGE_GATE_MISSING')
    assert.isTrue(result.meta.appliedFixes.some((fix) => fix.startsWith('stage_gate_repair:')))
    assert.isAbove(steps.filter((step) => step === 'branch_tasks').length, 0)
    assert.include(result.meta.appliedFixes, 'wbs_tasks_chunked_generation')
    assert.equal(
      result.status,
      'completed',
      JSON.stringify({
        code: result.errorCode,
        errors: result.errors?.slice(0, 6),
        stages: result.meta.stages?.map((s) => [s.stage, s.status, s.errorCodes]),
      }),
    )
    assert.lengthOf(result.draft!.tasks, staged.tasks.length)
    assert.isTrue(validateProjectDraft(result.draft).ok)
  })

  test('marker 缺 reason、source 误填依据文本：归一化确定性修补，不触发修复重跑', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    let wbsCalls = 0
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage }) => {
        const output = stagedOutput(stage!) as {
          wbs?: Array<{ description: { marker: Record<string, unknown> } }>
        }
        if (stage === 'wbs_tasks' && output.wbs?.[0]) {
          wbsCalls += 1
          output.wbs[0].description.marker = { confidence: 0.9, source: '按交付物拆分' }
          // 可选字段（逐字段归一化覆盖不到）同样要被修补。
          const tasks = (output as { tasks?: Array<Record<string, unknown>> }).tasks
          if (tasks?.[0]) {
            tasks[0].assigneeRoleIds = { value: ['app-dev'], marker: { source: '按角色' } }
          }
        }
        return JSON.stringify(output)
      },
    })
    assert.equal(wbsCalls, 1, 'marker 元数据缺陷不应触发 WBS 阶段重跑')
    assert.equal(result.status, 'completed')
    assert.equal(result.retries, 0)
    const wbsStage = result.meta.stages?.find((stage) => stage.stage === 'wbs_tasks')
    assert.equal(wbsStage?.status, 'completed')
    assert.equal(wbsStage?.attemptCount, 1)
  })

  test('排期阶段 JSON 仅缺闭合括号：逐条抢救依赖并推导甘特，不触发重跑', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    let scheduleCalls = 0
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage }) => {
        if (stage === 'schedule_dependencies') {
          scheduleCalls += 1
          const output = stagedOutput(stage) as { dependencies: unknown[] }
          // 依赖逐条完整，但整体 JSON 未闭合、甘特预览丢失。
          return `{"dependencies":[${output.dependencies.map((item) => JSON.stringify(item)).join(',')}`
        }
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(scheduleCalls, 1, '可抢救的排期输出不应触发重跑')
    // 逐条抢救（schedule_dependencies_salvaged）或补括号后解析、甘特由程序推导（gantt_preview_derived）都算抢救成功。
    assert.isTrue(
      result.meta.appliedFixes.some(
        (fix) => fix === 'schedule_dependencies_salvaged' || fix === 'gantt_preview_derived',
      ),
    )
    assert.equal(result.status, 'completed')
    assert.isTrue(validateProjectDraft(result.draft).ok)
  })

  test('小型项目 WBS 阶段仍走单次请求', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    let chunkCalls = 0
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage, prompt }) => {
        if (stage === 'wbs_tasks' && (JSON.parse(prompt.userPrompt) as { step?: string }).step) {
          chunkCalls += 1
        }
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(chunkCalls, 0)
    assert.notInclude(result.meta.appliedFixes, 'wbs_tasks_chunked_generation')
  })

  test('WBS 阶段 prompt 按团队规模与周期写入颗粒度要求', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    let wbsSystemPrompt = ''
    await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage, prompt }) => {
        if (stage === 'wbs_tasks') wbsSystemPrompt = prompt.systemPrompt
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.include(wbsSystemPrompt, '【颗粒度要求】')
    assert.match(wbsSystemPrompt, /tasks 输出 \d+–\d+ 个/)
    assert.include(wbsSystemPrompt, '3–10 个工作日')
  })

  test('某阶段修复预算耗尽仍不合法：该阶段失败、后续阶段不执行、整体不可确认', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    const stagesSeen: string[] = []
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage }) => {
        stagesSeen.push(stage!)
        if (stage === 'schedule_dependencies') {
          return JSON.stringify({ dependencies: [{ id: 'dep-1' }], ganttPreview: {} })
        }
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'STAGE_GENERATION_FAILED')
    assert.equal(result.stage, 'schedule_dependencies')
    assert.equal(result.reasonCode, 'STAGE_GENERATION_FAILED')
    assert.equal(result.meta.failure?.stage, 'schedule_dependencies')
    assert.equal(result.meta.failure?.reasonCode, 'STAGE_GENERATION_FAILED')
    assert.isDefined(result.meta.failure?.errors)
    assert.isAbove(result.meta.failure!.errors!.length, 0)
    assert.deepEqual(
      [...new Set(stagesSeen)],
      ['charter_scope', 'wbs_tasks', 'schedule_dependencies'],
    )
    const schedule = result.meta.stages?.find((s) => s.stage === 'schedule_dependencies')
    assert.equal(schedule?.status, 'failed')
    assert.equal(schedule?.attemptCount, 2)
    const reconcile = result.meta.stages?.find((s) => s.stage === 'reconcile_review')
    assert.equal(reconcile?.errorCodes?.[0], 'STAGE_NOT_REACHED')
    assert.equal(result.meta.confirmability?.status, 'failed')
  })

  test('阶段生成失败时 meta.failure 包含 stage, reasonCode 与脱敏 errors 且不泄露 prompt/密钥', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 0,
      rawTextProvider: async ({ stage }) => {
        if (stage === 'charter_scope') {
          return 'invalid json sk-abcdef12345678 with auth Bearer secret-token'
        }
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.stage, 'charter_scope')
    assert.equal(result.reasonCode, 'MODEL_RESPONSE_JSON_INVALID')
    assert.equal(result.meta.failure?.stage, 'charter_scope')
    assert.equal(result.meta.failure?.reasonCode, 'MODEL_RESPONSE_JSON_INVALID')
    assert.isDefined(result.meta.failure?.errors)
    const failureStr = JSON.stringify(result.meta.failure)
    assert.notMatch(failureStr, /sk-[a-z0-9_-]{12,}|secret-token/i)
  })

  test('阶段 checkpoint 可恢复：失败后可复用已通过阶段，不重新生成章程/WBS', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    const calls: Record<string, number> = {}
    let latestCheckpoint: ProjectDraftPipelineCheckpoint | null = null
    let failedWbsOnce = false
    const raw = async ({ stage }: { stage?: ProjectDraftGenerationStage }) => {
      calls[stage ?? 'unknown'] = (calls[stage ?? 'unknown'] ?? 0) + 1
      if (stage === 'wbs_tasks' && !failedWbsOnce && (calls.wbs_tasks ?? 0) <= 2) {
        // 结构错误（wbsNodeId 悬空）连续两次失败，验证 checkpoint 从失败阶段恢复。
        const good = stagedOutput('wbs_tasks') as {
          wbs: unknown
          tasks: Array<Record<string, unknown>>
        }
        return JSON.stringify({
          wbs: good.wbs,
          tasks: good.tasks.map((task) => ({ ...task, wbsNodeId: 'wbs-不存在' })),
        })
      }
      return JSON.stringify(stagedOutput(stage!))
    }
    const first = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: raw,
      onCheckpoint: (checkpoint) => {
        latestCheckpoint = checkpoint
      },
    })
    assert.equal(first.status, 'failed')
    assert.isNotNull(latestCheckpoint)
    assert.isTrue(
      latestCheckpoint!.completedStages.some((stage) => stage.stage === 'charter_scope'),
    )

    failedWbsOnce = true
    const second = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      resume: latestCheckpoint,
      rawTextProvider: raw,
    })
    assert.equal(second.status, 'completed')
    assert.equal(calls.charter_scope, 1, 'charter 只应在第一次生成时调用，恢复时直接复用')
    assert.equal(calls.wbs_tasks, 3, 'wbs 失败 2 次 + 恢复后成功 1 次')
    assert.include(second.meta.appliedFixes, 'resume_stage_checkpoint')
    assert.isTrue(validateProjectDraft(second.draft).ok)
  })

  test('预算不足时不启动注定无法完成的阶段请求（为最终复核保留预算）', async ({ assert }) => {
    const service = new ProjectDraftGenerationService()
    let checkpoint: ProjectDraftPipelineCheckpoint | null = null
    await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage }) => {
        if (stage === 'wbs_tasks') return 'not-json{'
        return JSON.stringify(stagedOutput(stage!))
      },
      onCheckpoint: (snapshot) => {
        checkpoint = snapshot
      },
    })
    assert.isNotNull(checkpoint)
    // 五倍预算下仍只剩 120s，少于 wbs 最小尝试 + 最终复核预留 → 不再发起新请求。
    const exhausted = {
      ...(JSON.parse(JSON.stringify(checkpoint)) as ProjectDraftPipelineCheckpoint),
      spentMs: 125 * 60_000 - 120_000,
    }
    let wbsCalls = 0
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      resume: exhausted,
      rawTextProvider: async ({ stage }) => {
        if (stage === 'wbs_tasks') wbsCalls += 1
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'GENERATION_BUDGET_EXHAUSTED')
    // 说明部分指明是哪一道预算，而不是笼统的「超时」。
    assert.include(result.errors?.[0]?.message ?? '', '全程耗时预算')
    assert.equal(wbsCalls, 0, '预算不足时禁止发起新的 provider 请求')
  })

  test('阶段输出超出字符上限 → 说明指明输出长度，并保留上一次尝试的真实失败原因', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    let wbsCalls = 0
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      maxRetries: 1,
      rawTextProvider: async ({ stage }) => {
        if (stage === 'wbs_tasks') {
          wbsCalls += 1
          // 不遵守 max_tokens 的 provider：单次输出即超过五倍后的 wbs 125 万字符上限。
          return 'x'.repeat(1_251_000) + 'not-json{'
        }
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.errorCode, 'GENERATION_BUDGET_EXHAUSTED')
    assert.equal(wbsCalls, 1, '超出输出上限后不再发起重试')
    const messages = (result.errors ?? []).map((error) => error.message)
    assert.include(messages[0] ?? '', '本阶段模型输出长度超出上限')
    assert.isTrue(
      messages.slice(1).some((message) => message.startsWith('JSON_PARSE_FAILED')),
      `应保留上一次的解析失败原因，实际：${messages.join(' | ')}`,
    )
  })

  test('任务日期由程序排定：依赖一确定即按开工日与工作日历排期，全部落在工作日', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    const result = await service.generate({
      context: {
        ...INTERNAL_TICKET_QUALITY_CONTEXT,
        parsedIntent: {
          ...INTERNAL_TICKET_QUALITY_CONTEXT.parsedIntent,
          // 开工日 2026-10-10 是国庆调休上班的周六：程序排期按中国工作日历从这天开始，
          // 而不是沿用模型给的 9 月日期。
          timeline: { startDate: '2026-10-10', deadline: '2026-12-31', durationDays: 83 },
        },
        resolvedFields: {
          ...INTERNAL_TICKET_QUALITY_CONTEXT.resolvedFields,
          startDate: {
            value: '2026-10-10',
            marker: {
              confidence: 1,
              source: 'explicit',
              reason: '用户确认',
              needsConfirmation: false,
            },
          },
        },
      },
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      useStagePipeline: true,
      rawTextProvider: async ({ stage }) => JSON.stringify(stagedOutput(stage!)),
    })
    assert.equal(result.status, 'completed')
    assert.include(result.meta.appliedFixes, 'early_schedule_applied')
    assert.equal(result.draft!.charter.startDate.value, '2026-10-10')
    const calendar = buildDraftCalendar({ startDate: '2026-10-10', endDate: '2026-12-31' }).calendar
    for (const task of result.draft!.tasks) {
      assert.isTrue(
        isWorkingDay(calendar, parseIsoDate(task.startDate.value)),
        task.startDate.value,
      )
      assert.isTrue(isWorkingDay(calendar, parseIsoDate(task.endDate.value)), task.endDate.value)
      assert.isTrue(task.startDate.value >= '2026-10-10', task.startDate.value)
    }
  })

  test('分阶段路径透传结构化策略与阶段 JSON Schema（native 不降级为 prompt）', async ({
    assert,
  }) => {
    const service = new ProjectDraftGenerationService()
    const seen: Array<{ stage?: string; strategy?: string; jsonSchema?: unknown }> = []
    const result = await service.generate({
      context: INTERNAL_TICKET_QUALITY_CONTEXT,
      resolved: makeResolved({
        source: 'user',
        usingRealAdapter: true,
        capabilities: { supportsStrictSchema: true },
      }),
      useStagePipeline: true,
      rawTextProvider: async ({ stage, strategy, jsonSchema }) => {
        seen.push({ stage, strategy, jsonSchema })
        return JSON.stringify(stagedOutput(stage!))
      },
    })
    assert.equal(result.status, 'completed')
    assert.lengthOf(seen, 4)
    // 排期阶段输出紧凑数组格式（["前置","后继","FS",0]），走 prompt 策略、不带原生 Schema；其余阶段原样透传。
    const structured = seen.filter((item) => item.stage !== 'schedule_dependencies')
    assert.isTrue(structured.every((item) => item.strategy === 'native'))
    assert.isTrue(structured.every((item) => item.jsonSchema !== undefined))
    const schedule = seen.find((item) => item.stage === 'schedule_dependencies')
    assert.equal(schedule?.strategy, 'prompt')
    assert.isUndefined(schedule?.jsonSchema)
  })
})

async function formalWriteCounts() {
  const count = async (q: { count: (c: string) => any }) => {
    const row = await (q as any).count('* as total')
    return Number(row[0].$extras.total)
  }
  return {
    projects: await count(Project.query()),
    tasks: await count(Task.query()),
    wbsNodes: await count(WbsNode.query()),
    dependencies: await count(TaskDependency.query()),
    milestones: await count(Milestone.query()),
  }
}

test.group('AI 草案生成不写正式业务表', (group) => {
  useAuthDatabase(group)

  test('确定性与模型路径生成均零正式落库', async ({ assert }) => {
    const owner = await createUser()
    await createOrganization(owner)
    const service = new ProjectDraftGenerationService()
    const before = await formalWriteCounts()

    // 确定性引擎路径
    const det = await service.generate({ context: makeContext(), resolved: makeResolved() })
    assert.equal(det.status, 'completed')

    // 模型成功路径
    const ok = await service.generate({
      context: makeContext(),
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async () => JSON.stringify(fixtureDraft('event')),
    })
    assert.equal(ok.status, 'completed')

    // 模型失败路径
    const failed = await service.generate({
      context: makeContext(),
      resolved: makeResolved({ source: 'user', usingRealAdapter: true }),
      rawTextProvider: async () => 'garbage',
      maxRetries: 0,
    })
    assert.equal(failed.status, 'failed')

    assert.deepEqual(await formalWriteCounts(), before)
  })
})
