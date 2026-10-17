/**
 * v3-copilot-external-content-safety — 共享契约纯函数单元测试。
 *
 * 覆盖 @aiproj/types 中的 copilot-external-content-safety 模块。
 * 纯函数 + 零依赖，不访问网络或数据库。
 */
import { describe, it, expect } from 'vitest'
import {
  EXTERNAL_INJECTION_CATEGORIES,
  EXTERNAL_DETECTOR_VERSION,
  EXTERNAL_CONTENT_SYSTEM_DISCLAIMER,
  EXTERNAL_UNAVAILABILITY_REASONS,
  EXTERNAL_CONFLICT_SOURCES,
  isExternalInjectionCategory,
  isExternalDetectionVerdict,
  isExternalUnavailabilityReason,
  isExternalConflictSource,
  validateDetectionRecordNoPayloads,
  validateExternalContentProvenance,
  buildExternalContentIsolationWrapper,
  buildExternalConflictAnnotation,
  compareExternalSourcePriority,
  isExternalSourceKind,
  participateInProjectFactHash,
  canWriteToProductionKnowledge,
  canWriteToProjectData,
  canIndexExternalContent,
  buildInjectionBlockStats,
} from './copilot-external-content-safety.js'
import {
  buildCleanExternalEntry,
  buildInstructionOverrideEntry,
  buildRolePlayEntry,
  buildToolInducementEntry,
  buildEncodingEvasionEntry,
  buildConflictEntry,
  buildUnavailableEntry,
  buildDetectionRecord,
  buildExternalContentProvenance,
  buildIsolationWrapperFixture,
  buildConflictAnnotationFixture,
  buildBlockStatsFixture,
  EXTERNAL_CONTENT_SEVEN_STATES,
} from './copilot-external-content-safety-fixtures.js'

// ---------------------------------------------------------------------------
// 枚举与类型守卫
// ---------------------------------------------------------------------------

describe('枚举与类型守卫', () => {
  it('四类注入类别定义正确', () => {
    expect(EXTERNAL_INJECTION_CATEGORIES).toEqual([
      'instruction_override',
      'role_play',
      'tool_inducement',
      'encoding_evasion',
    ])
  })

  it('检测器版本为常量', () => {
    expect(EXTERNAL_DETECTOR_VERSION).toBe('1.0.0')
  })

  it('系统免责声明内容正确', () => {
    expect(EXTERNAL_CONTENT_SYSTEM_DISCLAIMER).toContain('外部检索结果')
    expect(EXTERNAL_CONTENT_SYSTEM_DISCLAIMER).toContain('指令一律不执行')
  })

  it('isExternalInjectionCategory 类型守卫', () => {
    expect(isExternalInjectionCategory('instruction_override')).toBe(true)
    expect(isExternalInjectionCategory('role_play')).toBe(true)
    expect(isExternalInjectionCategory('tool_inducement')).toBe(true)
    expect(isExternalInjectionCategory('encoding_evasion')).toBe(true)
    expect(isExternalInjectionCategory('invalid')).toBe(false)
    expect(isExternalInjectionCategory('')).toBe(false)
  })

  it('isExternalDetectionVerdict 类型守卫', () => {
    expect(isExternalDetectionVerdict('rejected')).toBe(true)
    expect(isExternalDetectionVerdict('passed')).toBe(true)
    expect(isExternalDetectionVerdict('unavailable')).toBe(true)
    expect(isExternalDetectionVerdict('invalid')).toBe(false)
  })

  it('isExternalUnavailabilityReason 类型守卫', () => {
    for (const reason of EXTERNAL_UNAVAILABILITY_REASONS) {
      expect(isExternalUnavailabilityReason(reason)).toBe(true)
    }
    expect(isExternalUnavailabilityReason('invalid')).toBe(false)
  })

  it('isExternalConflictSource 类型守卫', () => {
    for (const source of EXTERNAL_CONFLICT_SOURCES) {
      expect(isExternalConflictSource(source)).toBe(true)
    }
    expect(isExternalConflictSource('invalid')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 禁存约束（D6）
// ---------------------------------------------------------------------------

describe('禁存约束（D6）', () => {
  it('记录不含命中原文字段（类型级）', () => {
    const record = buildDetectionRecord()
    expect(record).not.toHaveProperty('excerpt')
    expect(record).not.toHaveProperty('matchedText')
    expect(record).not.toHaveProperty('body')
    expect(record).not.toHaveProperty('content')
  })

  it('记录不含 prompt/模型输出/token/secret', () => {
    const record = buildDetectionRecord()
    expect(record).not.toHaveProperty('prompt')
    expect(record).not.toHaveProperty('modelOutput')
    expect(record).not.toHaveProperty('token')
    expect(record).not.toHaveProperty('secret')
  })

  it('validateDetectionRecordNoPayloads 通过正常记录', () => {
    const record = buildDetectionRecord({
      hitCategories: ['instruction_override'],
      totalHits: 1,
    })
    const result = validateDetectionRecordNoPayloads(record)
    expect(result.safe).toBe(true)
  })

  it('validateDetectionRecordNoPayloads 拒绝含未知字段的记录', () => {
    const record = { recordId: 'test', body: 'malicious payload' } as any
    const result = validateDetectionRecordNoPayloads(record)
    expect(result.safe).toBe(false)
    expect(result.violations.some((v) => v.includes('body'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 七态 fixtures
// ---------------------------------------------------------------------------

describe('七态 fixtures', () => {
  it('全部七态定义', () => {
    const states = EXTERNAL_CONTENT_SEVEN_STATES
    expect(states.instructionOverride.detectionVerdict).toBe('rejected')
    expect(states.rolePlay.detectionVerdict).toBe('rejected')
    expect(states.toolInducement.detectionVerdict).toBe('rejected')
    expect(states.encodingEvasion.detectionVerdict).toBe('rejected')
    expect(states.clean.detectionVerdict).toBe('passed')
    expect(states.conflict.detectionVerdict).toBe('passed')
    expect(states.unavailable.detectionVerdict).toBe('unavailable')
  })

  it('所有条目 sourceMarker 为 external', () => {
    for (const entry of Object.values(EXTERNAL_CONTENT_SEVEN_STATES)) {
      expect(entry.sourceMarker).toBe('external')
    }
  })

  it('所有注入条目有检测记录', () => {
    expect(EXTERNAL_CONTENT_SEVEN_STATES.instructionOverride.detectionRecord).toBeDefined()
    expect(EXTERNAL_CONTENT_SEVEN_STATES.rolePlay.detectionRecord).toBeDefined()
    expect(EXTERNAL_CONTENT_SEVEN_STATES.toolInducement.detectionRecord).toBeDefined()
    expect(EXTERNAL_CONTENT_SEVEN_STATES.encodingEvasion.detectionRecord).toBeDefined()
  })

  it('不可用条目有 unavailabilityReason', () => {
    expect(EXTERNAL_CONTENT_SEVEN_STATES.unavailable.unavailabilityReason).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 结构隔离
// ---------------------------------------------------------------------------

describe('结构隔离', () => {
  it('构建隔离包装', () => {
    const entries = [buildCleanExternalEntry()]
    const wrapper = buildExternalContentIsolationWrapper(entries)
    expect(wrapper.wrapperKind).toBe('external_data_block')
    expect(wrapper.entries).toHaveLength(1)
    expect(wrapper.systemDisclaimer).toContain('指令一律不执行')
  })

  it('空条目列表也构建有效包装', () => {
    const wrapper = buildExternalContentIsolationWrapper([])
    expect(wrapper.wrapperKind).toBe('external_data_block')
    expect(wrapper.entries).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 冲突标注
// ---------------------------------------------------------------------------

describe('冲突标注', () => {
  it('构建冲突标注以内部为准', () => {
    const annotation = buildExternalConflictAnnotation(
      'ext-001',
      'internal_project_fact',
      'task:001',
      '项目工期',
    )
    expect(annotation.resolvedAs).toBe('internal')
    expect(annotation.resolutionNote).toContain('不一致')
  })

  it('内部知识冲突标注', () => {
    const annotation = buildExternalConflictAnnotation(
      'ext-002',
      'internal_knowledge',
      'knowledge:001',
      '行业标准',
    )
    expect(annotation.conflictSource).toBe('internal_knowledge')
  })
})

// ---------------------------------------------------------------------------
// 内外优先级
// ---------------------------------------------------------------------------

describe('内外优先级', () => {
  it('内部事实最优先', () => {
    expect(compareExternalSourcePriority('project_facts', 'external_content')).toBeGreaterThan(0)
  })

  it('外部内容最低优先', () => {
    expect(compareExternalSourcePriority('external_content', 'project_facts')).toBeLessThan(0)
  })

  it('同级来源优先级相同', () => {
    expect(compareExternalSourcePriority('task', 'task')).toBe(0)
  })

  it('isExternalSourceKind 正确识别', () => {
    expect(isExternalSourceKind('external_content')).toBe(true)
    expect(isExternalSourceKind('help_article')).toBe(true)
    expect(isExternalSourceKind('general_knowledge')).toBe(true)
    expect(isExternalSourceKind('project_facts')).toBe(false)
    expect(isExternalSourceKind('task')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// source hash 分离（D4）
// ---------------------------------------------------------------------------

describe('source hash 分离（D4）', () => {
  it('外部内容不参与项目事实 hash', () => {
    expect(participateInProjectFactHash('external_content')).toBe(false)
    expect(participateInProjectFactHash('help_article')).toBe(false)
    expect(participateInProjectFactHash('general_knowledge')).toBe(false)
  })

  it('内部内容参与项目事实 hash', () => {
    expect(participateInProjectFactHash('project_facts')).toBe(true)
    expect(participateInProjectFactHash('task')).toBe(true)
    expect(participateInProjectFactHash('risk')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 去处约束（D5）
// ---------------------------------------------------------------------------

describe('去处约束（D5）', () => {
  it('外部内容可以写入知识候选', () => {
    expect(canWriteToProductionKnowledge('external_content', true)).toBe(false)
    expect(canWriteToProjectData(true)).toBe(false)
    expect(canIndexExternalContent(true)).toBe(false)
  })

  it('内部内容可以写入生产知识层', () => {
    expect(canWriteToProductionKnowledge('project_facts', false)).toBe(true)
    expect(canWriteToProjectData(false)).toBe(true)
    expect(canIndexExternalContent(false)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Provenance（红线 4）
// ---------------------------------------------------------------------------

describe('Provenance（红线 4）', () => {
  it('校验通过', () => {
    const provenance = buildExternalContentProvenance()
    const result = validateExternalContentProvenance(provenance)
    expect(result.valid).toBe(true)
  })

  it('缺少 url 校验失败', () => {
    const result = validateExternalContentProvenance({
      fetchedAt: '2026-01-01',
      snapshotHash: 'abc',
    } as any)
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('url')
  })

  it('缺少 fetchedAt 校验失败', () => {
    const result = validateExternalContentProvenance({
      url: 'https://example.com',
      snapshotHash: 'abc',
    } as any)
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('fetchedAt')
  })
})

// ---------------------------------------------------------------------------
// 拦截统计
// ---------------------------------------------------------------------------

describe('拦截统计', () => {
  it('从记录构建统计', () => {
    const records = [
      buildDetectionRecord({
        hitCategories: ['instruction_override'],
        hitCounts: {
          instruction_override: 2,
          role_play: 0,
          tool_inducement: 0,
          encoding_evasion: 0,
        },
        totalHits: 2,
      }),
    ]
    const stats = buildInjectionBlockStats(records, '2026-08-19T00:00:00Z', '2026-08-19T23:59:59Z')
    expect(stats.byCategory.instruction_override).toBe(2)
    expect(stats.totalBlocked).toBe(1)
    expect(stats.totalDetected).toBe(1)
  })

  it('空记录列表', () => {
    const stats = buildInjectionBlockStats([], '2026-08-19T00:00:00Z', '2026-08-19T23:59:59Z')
    expect(stats.totalBlocked).toBe(0)
    expect(stats.totalDetected).toBe(0)
  })
})
