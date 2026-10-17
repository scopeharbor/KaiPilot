/**
 * ai-draft types — 编译期类型断言与运行时模块映射验证。
 *
 * §1 契约加法（v2-5-ai-draft-live-sse-transport）：
 *   - 新增事件类型必须是 ProjectDraftStreamEvent 的合法成员
 *   - MODULE_KEY_TO_JSON_FIELD 覆盖 PROJECT_DRAFT_MODULES 全部 9 项
 *   - 新增类型不含 rawText、prompt、token 敏感字段
 *   - PROGRESS_PHASES 为合法常量数组
 */

import { describe, it, expect } from 'vitest'
import {
  PROJECT_DRAFT_MODULES,
  PROJECT_DRAFT_EVENT_TYPES,
  MODULE_KEY_TO_JSON_FIELD,
  PROGRESS_PHASES,
  PROJECT_DRAFT_GENERATION_STAGES,
  PROJECT_DRAFT_CONFIRMABILITY_STATUSES,
  PROJECT_DRAFT_QUALITY_LIMITS,
  computeProjectDraftQualityHash,
  redactGroundingManifest,
  redactProjectDraftQualityText,
  redactProjectDraftFailureDetail,
  serializeProjectDraftGroundingManifest,
  serializeProjectDraftFailureDetail,
  type ProjectDraftStreamEvent,
  type DraftProgressEvent,
  type DraftHeartbeatEvent,
  type DraftFailedEvent,
  type ProgressPhase,
  type ProjectDraftGroundingManifest,
  type ProjectDraftRepairEnvelope,
  type ProjectDraftFailureDetail,
  type ProjectDraftFailureError,
  type ProjectDraftStage,
  type ProjectDraftGenerationStage,
  type ProjectDraftDetail,
} from './ai-draft.ts'

// ── 1.3 类型编译断言 ────────────────────────────────────────────────────────

describe('ai-draft event types', () => {
  it('draft.progress 属于 ProjectDraftStreamEvent 联合类型', () => {
    const event: ProjectDraftStreamEvent = {
      type: 'draft.progress',
      draftId: 'test',
      version: 1,
      sequence: 1,
      phase: 'adapter_ready',
      receivedChars: 0,
    }
    expect(event.type).toBe('draft.progress')
  })

  it('draft.heartbeat 属于 ProjectDraftStreamEvent 联合类型', () => {
    const event: ProjectDraftStreamEvent = {
      type: 'draft.heartbeat',
      draftId: 'test',
      version: 1,
      sequence: 1,
      elapsedMs: 1000,
    }
    expect(event.type).toBe('draft.heartbeat')
  })

  it('PROJECT_DRAFT_EVENT_TYPES 包含新增事件', () => {
    expect(PROJECT_DRAFT_EVENT_TYPES).toContain('draft.progress')
    expect(PROJECT_DRAFT_EVENT_TYPES).toContain('draft.heartbeat')
  })

  it('PROGRESS_PHASES 为合法常量数组', () => {
    expect(PROGRESS_PHASES).toContain('adapter_ready')
    expect(PROGRESS_PHASES).toContain('first_token')
    expect(PROGRESS_PHASES).toContain('receiving')
    expect(PROGRESS_PHASES).toContain('parsing')
    expect(PROGRESS_PHASES).toContain('validating')
    expect(PROGRESS_PHASES).toContain('retrying')
    expect(PROGRESS_PHASES).toContain('persisting')
  })

  it('DraftProgressEvent 不含敏感字段', () => {
    // 类型层面验证：只有 phase/receivedChars/attempt
    const event: DraftProgressEvent = {
      type: 'draft.progress',
      draftId: 'test',
      version: 1,
      sequence: 1,
      phase: 'receiving',
      receivedChars: 42,
    }
    // @ts-expect-error — rawText 不应存在于类型上
    const _noRawText: undefined = (event as { rawText?: unknown }).rawText
    // @ts-expect-error — prompt 不应存在于类型上
    const _noPrompt: undefined = (event as { prompt?: unknown }).prompt
    expect(_noRawText).toBeUndefined()
    expect(_noPrompt).toBeUndefined()
    // 运行时也断言 payload 安全
    const safe = JSON.stringify(event)
    expect(safe).not.toContain('rawText')
    expect(safe).not.toContain('prompt')
    expect(safe).not.toContain('token')
  })

  it('DraftHeartbeatEvent 只含低敏 elapsedMs', () => {
    const event: DraftHeartbeatEvent = {
      type: 'draft.heartbeat',
      draftId: 'test',
      version: 1,
      sequence: 1,
      elapsedMs: 500,
    }
    const safe = JSON.stringify(event)
    expect(safe).not.toContain('rawText')
    expect(safe).not.toContain('token')
  })

  it('phase 值类型安全', () => {
    // 验证 phase 参数符合 ProgressPhase
    const phase: ProgressPhase = 'first_token'
    expect([
      'adapter_ready',
      'first_token',
      'receiving',
      'parsing',
      'validating',
      'retrying',
      'persisting',
    ]).toContain(phase)
  })
})

// ── 1.2 模块键映射 ────────────────────────────────────────────────────────────

describe('MODULE_KEY_TO_JSON_FIELD', () => {
  it('覆盖 PROJECT_DRAFT_MODULES 全部 9 项', () => {
    const mappedKeys = Object.keys(
      MODULE_KEY_TO_JSON_FIELD,
    ) as (keyof typeof MODULE_KEY_TO_JSON_FIELD)[]
    for (const module of PROJECT_DRAFT_MODULES) {
      expect(mappedKeys).toContain(module)
      expect(typeof MODULE_KEY_TO_JSON_FIELD[module]).toBe('string')
    }
  })

  it('非同名模块正确映射到 JSON 字段名', () => {
    expect(MODULE_KEY_TO_JSON_FIELD.acceptance).toBe('acceptanceCriteria')
    expect(MODULE_KEY_TO_JSON_FIELD.resource).toBe('resourceHints')
    expect(MODULE_KEY_TO_JSON_FIELD.risk).toBe('riskHints')
    expect(MODULE_KEY_TO_JSON_FIELD.milestone).toBe('milestoneHints')
  })

  it('同名模块映射到自身', () => {
    expect(MODULE_KEY_TO_JSON_FIELD.charter).toBe('charter')
    expect(MODULE_KEY_TO_JSON_FIELD.wbs).toBe('wbs')
    expect(MODULE_KEY_TO_JSON_FIELD.tasks).toBe('tasks')
    expect(MODULE_KEY_TO_JSON_FIELD.dependencies).toBe('dependencies')
    expect(MODULE_KEY_TO_JSON_FIELD.ganttPreview).toBe('ganttPreview')
  })
})

// ── task 1.2：质量/来源投影契约 ──────────────────────────────────────────────

function groundingManifest(
  overrides: Partial<ProjectDraftGroundingManifest> = {},
): ProjectDraftGroundingManifest {
  return {
    version: '1.0',
    projectType: 'software',
    facts: [
      {
        id: 'domain:1',
        category: 'domain',
        normalizedValue: 'software',
        source: 'parsed',
        required: true,
        hash: 'hash-domain',
      },
      {
        id: 'business_concept:1',
        category: 'business_concept',
        normalizedValue: '内部工单系统，密钥 sk-abcdefghijklmnop',
        source: 'confirmed',
        required: true,
        hash: 'hash-concept',
      },
    ],
    hash: 'hash-manifest',
    truncated: false,
    ...overrides,
  }
}

describe('ai-draft quality projection types', () => {
  it('五阶段与三态可确认性常量稳定', () => {
    expect(PROJECT_DRAFT_GENERATION_STAGES).toEqual([
      'charter_scope',
      'wbs_tasks',
      'schedule_dependencies',
      'resources_risks_acceptance',
      'reconcile_review',
    ])
    expect(PROJECT_DRAFT_CONFIRMABILITY_STATUSES).toEqual([
      'confirmable',
      'review_blocked',
      'failed',
    ])
  })

  it('上界常量有界且可预期', () => {
    expect(PROJECT_DRAFT_QUALITY_LIMITS.maxGroundingFacts).toBe(32)
    expect(PROJECT_DRAFT_QUALITY_LIMITS.maxStages).toBe(5)
    expect(PROJECT_DRAFT_QUALITY_LIMITS.maxAllowedTools).toBe(2)
    expect(PROJECT_DRAFT_QUALITY_LIMITS.maxRepairFieldPaths).toBe(20)
  })

  it('serializeProjectDraftGroundingManifest 确定性且裁断到上界', () => {
    const manifest = groundingManifest({
      facts: Array.from({ length: 40 }, (_, index) => ({
        id: 'business_concept:' + index,
        category: 'business_concept' as const,
        normalizedValue: 'value-' + index,
        source: 'confirmed' as const,
        required: true,
        hash: 'hash-' + index,
      })),
    })
    const serialized = serializeProjectDraftGroundingManifest(manifest)
    const parsed = JSON.parse(serialized) as ProjectDraftGroundingManifest
    expect(parsed.facts).toHaveLength(32)
    expect(serializeProjectDraftGroundingManifest(manifest)).toBe(serialized)
  })

  it('redactGroundingManifest 清除 secret/Authorization/邮箱，保留稳定 ID', () => {
    const manifest = groundingManifest({
      facts: [
        {
          id: 'business_concept:1',
          category: 'business_concept',
          normalizedValue:
            '密钥 sk-abcdefghijklmnop 和 Authorization: Bearer abc 联系 pm@example.com',
          source: 'confirmed',
          required: true,
          hash: 'hash-1',
        },
      ],
    })
    const redacted = redactGroundingManifest(manifest)
    expect(redacted.facts[0].normalizedValue).not.toMatch(
      /sk-abcdefghijklmnop|Bearer|pm@example.com/,
    )
    expect(redacted.facts[0].id).toBe('business_concept:1')
  })

  it('computeProjectDraftQualityHash 稳定且与对象键序无关', () => {
    const left = { stage: 'charter_scope', allowedTools: ['draft.reference_lookup'] }
    const right = { allowedTools: ['draft.reference_lookup'], stage: 'charter_scope' }
    expect(computeProjectDraftQualityHash(left)).toBe(computeProjectDraftQualityHash(right))
  })

  it('RepairEnvelope 只携带有界字段路径与脱敏事实 ID', () => {
    const envelope: ProjectDraftRepairEnvelope = {
      version: '1.0',
      stage: 'reconcile_review',
      attempt: 1,
      errorCategories: ['schema'],
      fieldPaths: ['tasks[0].durationDays'],
      missingFactIds: ['business_concept:1'],
      remainingAttempts: 0,
      requestFingerprint: 'fp',
    }
    const serialized = JSON.stringify(envelope)
    expect(serialized).not.toMatch(/rawInput|prompt|token|secret|apiKey/i)
    expect(envelope.fieldPaths).toHaveLength(1)
  })
})

// ── 任务 1.1：草案失败详情模型与序列化契约 ───────────────────────────────────

describe('ProjectDraftFailureDetail and DraftFailedEvent failure projection', () => {
  it('ProjectDraftStage 与 ProjectDraftGenerationStage 类型等价', () => {
    const stage: ProjectDraftStage = 'wbs_tasks'
    const genStage: ProjectDraftGenerationStage = stage
    expect(genStage).toBe('wbs_tasks')
  })

  it('DraftFailedEvent 携带 stage, reasonCode, 低敏 errors 字段且类型兼容', () => {
    const event: DraftFailedEvent = {
      type: 'draft.failed',
      draftId: 'draft-failed-1',
      version: 1,
      sequence: 5,
      errorCode: 'MODEL_STAGE_OUTPUT_INCOMPLETE',
      message: '模型遗漏了当前阶段的必要内容，自动修复后仍不完整。',
      consistency: 'failed',
      stage: 'wbs_tasks',
      reasonCode: 'MODEL_STAGE_OUTPUT_INCOMPLETE',
      errors: [
        {
          path: 'tasks[0].name',
          message: '任务名称缺失',
          code: 'FIELD_REQUIRED',
        },
      ],
    }

    const streamEvent: ProjectDraftStreamEvent = event
    expect(streamEvent.type).toBe('draft.failed')
    if (streamEvent.type === 'draft.failed') {
      expect(streamEvent.stage).toBe('wbs_tasks')
      expect(streamEvent.reasonCode).toBe('MODEL_STAGE_OUTPUT_INCOMPLETE')
      expect(streamEvent.errors).toHaveLength(1)
      expect(streamEvent.errors?.[0].path).toBe('tasks[0].name')
    }
  })

  it('ProjectDraftDetail.failure 兼容 ProjectDraftFailureDetail 结构', () => {
    const failure: ProjectDraftFailureDetail = {
      errorCode: 'GROUNDING_VALIDATION_FAILED',
      message: '草案未完整覆盖已确认事实，已阻止进入确认导入。',
      consistency: 'failed',
      sequence: 12,
      stage: 'reconcile_review',
      reasonCode: 'HL-001',
      errors: [
        {
          path: 'charter.objectives',
          message: '缺少必需业务事实事实项',
          code: 'HL-001',
        },
      ],
    }

    const detail: ProjectDraftDetail = {
      draftId: 'draft-123',
      version: 0,
      status: 'error',
      generationState: 'settled',
      projectType: 'software',
      draft: null,
      meta: null,
      validation: null,
      events: [],
      failure,
    }

    expect(detail.failure?.stage).toBe('reconcile_review')
    expect(detail.failure?.reasonCode).toBe('HL-001')
    expect(detail.failure?.errors?.[0].code).toBe('HL-001')
  })

  it('redactProjectDraftFailureDetail 深度脱敏 secret/token/邮箱/Authorization', () => {
    const detail: ProjectDraftFailureDetail = {
      errorCode: 'STAGE_GENERATION_FAILED',
      message: '调用失败 sk-abcdefghijklmnop 联系 admin@test.com',
      consistency: 'failed',
      sequence: 3,
      stage: 'charter_scope',
      reasonCode: 'MODEL_PROVIDER_CALL_FAILED',
      errors: [
        {
          path: 'tasks[Bearer sk-123456789012].name',
          message: 'Authorization: Bearer secret-token-value 发生错误',
          code: 'AUTH_LEAK',
        },
      ],
    }

    const redacted = redactProjectDraftFailureDetail(detail)
    expect(redacted.message).not.toMatch(/sk-[a-z0-9_-]{12,}|admin@test\.com/i)
    expect(redacted.message).toContain('[REDACTED_SECRET]')
    expect(redacted.message).toContain('[REDACTED_EMAIL]')
    expect(redacted.errors?.[0].message).not.toContain('secret-token-value')
    expect(redacted.errors?.[0].path).not.toMatch(/sk-123456789012/)
  })

  it('serializeProjectDraftFailureDetail 输出确定性 JSON 且无敏感数据泄露', () => {
    const detail: ProjectDraftFailureDetail = {
      errorCode: 'GENERATION_BUDGET_EXHAUSTED',
      message: '生成超时',
      consistency: 'failed',
      sequence: 8,
      stage: 'schedule_dependencies',
      reasonCode: 'GENERATION_BUDGET_EXHAUSTED',
      errors: [
        {
          path: '(root)',
          message: 'GENERATION_BUDGET_EXHAUSTED',
          code: 'GENERATION_BUDGET_EXHAUSTED',
        },
      ],
    }

    const serialized1 = serializeProjectDraftFailureDetail(detail)
    const serialized2 = serializeProjectDraftFailureDetail(detail)
    expect(serialized1).toBe(serialized2)

    const parsed = JSON.parse(serialized1) as ProjectDraftFailureDetail
    expect(parsed.errorCode).toBe('GENERATION_BUDGET_EXHAUSTED')
    expect(parsed.stage).toBe('schedule_dependencies')
    expect(parsed.reasonCode).toBe('GENERATION_BUDGET_EXHAUSTED')
    expect(parsed.errors).toHaveLength(1)
    expect(serialized1).not.toMatch(/rawInput|prompt|apiKey|bearer/i)
  })
})
