/**
 * v3-enterprise-dlp-watermarking — 企业级 DLP 水印共享契约测试。
 *
 * 覆盖：稳定 hash、未知模式拒绝、模板白名单、样式边界、DLP block 优先、格式降级。
 */

import { describe, expect, it } from 'vitest'
import {
  // 类型守卫
  isWatermarkPolicyId,
  isWatermarkRuleId,
  isWatermarkMode,
  isWatermarkFormat,
  isWatermarkFormatSupportLevel,
  isWatermarkPolicyScope,
  isWatermarkStatus,
  isWatermarkRenderResult,
  isWatermarkEventType,
  isWatermarkWarningCode,
  isWatermarkVerificationStatus,
  isWatermarkConfirmationStatus,

  // 纯函数
  computeWatermarkPolicyHash,
  computeWatermarkTemplateHash,
  computeWatermarkPayloadHash,
  computeWatermarkPlanHash,
  computeWatermarkHash,
  computeWatermarkPreviewHash,
  computeRenderedTextHash,
  validateWatermarkTemplateVariables,
  isOpacityInRange,
  isFontSizeInRange,
  isRotationInRange,
  isRepeatCountInRange,
  isRenderedTextLengthInRange,
  validateWatermarkStyleBounds,
  isFormatRenderable,
  resolveWatermarkFollowUp,
  buildFormatMatrix,
  buildWatermarkPayload,
  redactWatermarkMetadata,
  isWatermarkPlanExpired,
  sortWatermarkWarnings,
  buildDefaultWatermarkStyle,
  buildDefaultWatermarkPolicySummary,
  getFormatSupportLevel,

  // 常量
  WATERMARK_POLICY_IDS,
  WATERMARK_MODES,
  WATERMARK_FORMATS,
  WATERMARK_FORMAT_SUPPORT_LEVELS,
  WATERMARK_WARNING_CODES,
  WATERMARK_EVENT_TYPES,
  WATERMARK_APPROVED_TEMPLATE_VARIABLES,
  WATERMARK_FORBIDDEN_KEYS,
  WATERMARK_OPACITY_MIN,
  WATERMARK_OPACITY_MAX,
  WATERMARK_FONT_SIZE_MIN,
  WATERMARK_FONT_SIZE_MAX,
  WATERMARK_ROTATION_MIN,
  WATERMARK_ROTATION_MAX,
  WATERMARK_MAX_REPEAT_COUNT,
  WATERMARK_MAX_TEXT_LENGTH,
  WATERMARK_PLAN_TTL_SECONDS,
  WATERMARK_PREVIEW_TTL_SECONDS,
  WATERMARK_NATIVE_FORMATS,

  // 类型
  type WatermarkStyle,
  type WatermarkWarningCode,
  type WatermarkFormat,
  type WatermarkFormatSupportLevel,
} from './enterprise-dlp-watermarking.js'
import {
  buildWatermarkPolicySummary,
  buildStrictWatermarkPolicy,
  wmBuildBlockDecision,
  wmBuildAllowDecision,
  wmBuildMaskDecision,
  wmBuildConfirmRequiredDecision,
  buildWatermarkPlan,
  buildStaleWatermarkPlan,
  buildWatermarkPayloadFixture,
  buildRenderSuccessResult,
  buildRenderDegradedResult,
  buildRenderBlockedResult,
  buildWatermarkLedgerEvent,
  buildCrossOrganizationDenialEvent,
  buildWatermarkPreviewRequest,
  buildWatermarkPreviewResult,
  buildFormatMatrixEntry,
  buildUnsupportedFormatEntry,
  buildWatermarkVerificationResult,
  buildTamperedVerificationResult,
  buildEmptyEventList,
  buildEventList,
} from './enterprise-dlp-watermarking-fixtures.js'

describe('水印共享契约 — 稳定 hash', () => {
  it('computeWatermarkPolicyHash 产生确定性结果', () => {
    const style: WatermarkStyle = {
      opacity: 0.3,
      fontSize: 12,
      rotation: 0,
      repeat: false,
      repeatCount: 1,
      position: 'footer',
      color: '#999999',
      maxLength: 200,
    }
    const a = computeWatermarkPolicyHash({
      enabledPolicies: ['watermark_visible'],
      policyModes: { watermark_visible: 'visible' },
      template: 'test',
      style,
      formatSupport: {},
      organizationId: 1,
    })
    const b = computeWatermarkPolicyHash({
      enabledPolicies: ['watermark_visible'],
      policyModes: { watermark_visible: 'visible' },
      template: 'test',
      style,
      formatSupport: {},
      organizationId: 1,
    })
    expect(a).toBe(b)
  })

  it('computeWatermarkPolicyHash 输入不同产生不同 hash', () => {
    const style: WatermarkStyle = {
      opacity: 0.3,
      fontSize: 12,
      rotation: 0,
      repeat: false,
      repeatCount: 1,
      position: 'footer',
      color: '#999999',
      maxLength: 200,
    }
    const a = computeWatermarkPolicyHash({
      enabledPolicies: ['watermark_visible'],
      policyModes: { watermark_visible: 'visible' },
      template: 'template_a',
      style,
      formatSupport: {},
      organizationId: 1,
    })
    const b = computeWatermarkPolicyHash({
      enabledPolicies: ['watermark_visible'],
      policyModes: { watermark_visible: 'visible' },
      template: 'template_b',
      style,
      formatSupport: {},
      organizationId: 1,
    })
    expect(a).not.toBe(b)
  })

  it('computeWatermarkTemplateHash 产生确定性结果', () => {
    expect(computeWatermarkTemplateHash('hello')).toBe(computeWatermarkTemplateHash('hello'))
    expect(computeWatermarkTemplateHash('hello')).not.toBe(computeWatermarkTemplateHash('Hello'))
  })

  it('computeWatermarkPlanHash 产生确定性结果', () => {
    const a = computeWatermarkPlanHash({
      actorId: 1,
      organizationId: 1,
      projectId: 1,
      action: 'export',
      sourceHash: 'abc',
      policyHash: 'def',
      decisionHash: 'ghi',
      format: 'markdown',
      mode: 'visible',
    })
    const b = computeWatermarkPlanHash({
      actorId: 1,
      organizationId: 1,
      projectId: 1,
      action: 'export',
      sourceHash: 'abc',
      policyHash: 'def',
      decisionHash: 'ghi',
      format: 'markdown',
      mode: 'visible',
    })
    expect(a).toBe(b)
  })

  it('computeWatermarkPayloadHash 产生确定性结果', () => {
    const a = computeWatermarkPayloadHash({
      watermarkId: 'wm_1',
      planHash: 'abc',
      decisionHash: 'def',
      sourceHash: 'ghi',
    })
    const b = computeWatermarkPayloadHash({
      watermarkId: 'wm_1',
      planHash: 'abc',
      decisionHash: 'def',
      sourceHash: 'ghi',
    })
    expect(a).toBe(b)
  })

  it('computeWatermarkHash 产生确定性结果', () => {
    const a = computeWatermarkHash({ planHash: 'abc', payloadHash: 'def', renderedTextHash: 'ghi' })
    const b = computeWatermarkHash({ planHash: 'abc', payloadHash: 'def', renderedTextHash: 'ghi' })
    expect(a).toBe(b)
  })

  it('computeWatermarkPreviewHash 产生确定性结果', () => {
    const style: WatermarkStyle = {
      opacity: 0.3,
      fontSize: 12,
      rotation: 0,
      repeat: false,
      repeatCount: 1,
      position: 'footer',
      color: '#999999',
      maxLength: 200,
    }
    const a = computeWatermarkPreviewHash({
      template: 'hello',
      templateVariables: { user_display: 'user' },
      style,
      format: 'markdown',
      mode: 'visible',
    })
    const b = computeWatermarkPreviewHash({
      template: 'hello',
      templateVariables: { user_display: 'user' },
      style,
      format: 'markdown',
      mode: 'visible',
    })
    expect(a).toBe(b)
  })

  it('computeRenderedTextHash 产生确定性结果', () => {
    expect(computeRenderedTextHash('watermark')).toBe(computeRenderedTextHash('watermark'))
  })
})

describe('水印共享契约 — 未知模式拒绝', () => {
  it('isWatermarkMode 拒绝未知模式', () => {
    expect(isWatermarkMode('visible')).toBe(true)
    expect(isWatermarkMode('invisible')).toBe(true)
    expect(isWatermarkMode('metadata')).toBe(true)
    expect(isWatermarkMode('unknown')).toBe(false)
    expect(isWatermarkMode(123)).toBe(false)
    expect(isWatermarkMode(null)).toBe(false)
  })

  it('isWatermarkFormat 拒绝未知格式', () => {
    expect(isWatermarkFormat('markdown')).toBe(true)
    expect(isWatermarkFormat('pdf')).toBe(true)
    expect(isWatermarkFormat('excel')).toBe(false)
    expect(isWatermarkFormat('docx')).toBe(false)
  })

  it('isWatermarkWarningCode 拒绝未知代码', () => {
    expect(isWatermarkWarningCode('WM_POLICY_STALE')).toBe(true)
    expect(isWatermarkWarningCode('WM_PLAN_EXPIRED')).toBe(true)
    expect(isWatermarkWarningCode('UNKNOWN_CODE')).toBe(false)
  })

  it('isWatermarkEventType 拒绝未知事件类型', () => {
    expect(isWatermarkEventType('render_success')).toBe(true)
    expect(isWatermarkEventType('policy_update')).toBe(true)
    expect(isWatermarkEventType('unknown_event')).toBe(false)
  })
})

describe('水印共享契约 — 模板白名单', () => {
  it('所有已批准变量通过验证', () => {
    const variables: Partial<Record<string, string>> = {}
    for (const v of WATERMARK_APPROVED_TEMPLATE_VARIABLES) {
      variables[v] = 'test_value'
    }
    const rejected = validateWatermarkTemplateVariables(variables)
    expect(rejected).toEqual([])
  })

  it('拒绝未批准的变量', () => {
    const variables: Partial<Record<string, string>> = {
      user_display: 'user',
      source_path: '/etc/passwd',
      prompt: 'this is a prompt',
      classification: 'internal',
    }
    const rejected = validateWatermarkTemplateVariables(variables)
    expect(rejected).toContain('source_path')
    expect(rejected).toContain('prompt')
    expect(rejected).not.toContain('user_display')
    expect(rejected).not.toContain('classification')
  })

  it('拒绝敏感变量（raw source、prompt、OCR、绝对路径、密钥）', () => {
    const variables: Partial<Record<string, string>> = {
      raw_source: 'sensitive content',
      model_prompt: 'prompt text',
      ocr_text: 'OCR result',
      absolute_path: '/home/user/file.txt',
      api_key: 'sk-xxx',
    }
    const rejected = validateWatermarkTemplateVariables(variables)
    expect(rejected.length).toBeGreaterThanOrEqual(5)
  })

  it('空变量对象通过验证', () => {
    expect(validateWatermarkTemplateVariables({})).toEqual([])
  })
})

describe('水印共享契约 — 样式边界', () => {
  it('不透明度在有效范围内', () => {
    expect(isOpacityInRange(0.3)).toBe(true)
    expect(isOpacityInRange(0.05)).toBe(true)
    expect(isOpacityInRange(1.0)).toBe(true)
    expect(isOpacityInRange(0)).toBe(false)
    expect(isOpacityInRange(1.1)).toBe(false)
    expect(isOpacityInRange(-0.1)).toBe(false)
  })

  it('字体大小在有效范围内', () => {
    expect(isFontSizeInRange(12)).toBe(true)
    expect(isFontSizeInRange(6)).toBe(true)
    expect(isFontSizeInRange(72)).toBe(true)
    expect(isFontSizeInRange(4)).toBe(false)
    expect(isFontSizeInRange(100)).toBe(false)
  })

  it('旋转角度在有效范围内', () => {
    expect(isRotationInRange(0)).toBe(true)
    expect(isRotationInRange(-90)).toBe(true)
    expect(isRotationInRange(90)).toBe(true)
    expect(isRotationInRange(-91)).toBe(false)
    expect(isRotationInRange(91)).toBe(false)
  })

  it('重复次数在有效范围内', () => {
    expect(isRepeatCountInRange(1)).toBe(true)
    expect(isRepeatCountInRange(50)).toBe(true)
    expect(isRepeatCountInRange(0)).toBe(false)
    expect(isRepeatCountInRange(51)).toBe(false)
  })

  it('渲染文本长度在有效范围内', () => {
    expect(isRenderedTextLengthInRange(10)).toBe(true)
    expect(isRenderedTextLengthInRange(500)).toBe(true)
    expect(isRenderedTextLengthInRange(0)).toBe(false)
    expect(isRenderedTextLengthInRange(501)).toBe(false)
  })

  it('validateWatermarkStyleBounds 返回超限 warning', () => {
    const validStyle: WatermarkStyle = {
      opacity: 0.3,
      fontSize: 12,
      rotation: 0,
      repeat: false,
      repeatCount: 1,
      position: 'footer',
      color: '#999999',
      maxLength: 200,
    }
    expect(validateWatermarkStyleBounds(validStyle)).toEqual([])

    const invalidStyle: WatermarkStyle = {
      opacity: 2.0,
      fontSize: 100,
      rotation: 180,
      repeat: false,
      repeatCount: 0,
      position: 'footer',
      color: '#999999',
      maxLength: 600,
    }
    const warnings = validateWatermarkStyleBounds(invalidStyle)
    expect(warnings.filter((w) => w === 'WM_STYLE_BOUND_EXCEEDED').length).toBeGreaterThanOrEqual(4)
  })
})

describe('水印共享契约 — DLP block 优先', () => {
  it('DLP block 时水印不生成 follow-up', () => {
    const decision = wmBuildBlockDecision()
    const followUp = resolveWatermarkFollowUp({
      dlpResult: decision.result,
      format: 'markdown',
      formatSupport: {},
      policyEnabled: true,
      blockUnsupported: false,
    })
    expect(followUp.watermarkRequired).toBe(false)
    expect(followUp.policyId).toBeNull()
  })

  it('DLP allow 时可根据策略添加水印', () => {
    const decision = wmBuildAllowDecision()
    const formatMatrix = buildFormatMatrix()
    const formatSupport: Partial<
      Record<
        WatermarkFormat,
        {
          level: WatermarkFormatSupportLevel
          strategy: string
          warningCode: WatermarkWarningCode | null
        }
      >
    > = {}
    for (const entry of formatMatrix) {
      formatSupport[entry.format] = {
        level: entry.level,
        strategy: entry.strategy,
        warningCode: entry.warningCode,
      }
    }

    const followUp = resolveWatermarkFollowUp({
      dlpResult: decision.result,
      format: 'markdown',
      formatSupport: formatSupport as Partial<
        Record<
          WatermarkFormat,
          {
            level: WatermarkFormatSupportLevel
            strategy: string
            warningCode: WatermarkWarningCode | null
          }
        >
      >,
      policyEnabled: true,
      blockUnsupported: false,
    })
    expect(followUp.watermarkRequired).toBe(true)
    expect(followUp.policyId).toBe('watermark_visible')
  })

  it('DLP allow 但策略禁用时水印不生成', () => {
    const decision = wmBuildAllowDecision()
    const followUp = resolveWatermarkFollowUp({
      dlpResult: decision.result,
      format: 'markdown',
      formatSupport: {},
      policyEnabled: false,
      blockUnsupported: false,
    })
    expect(followUp.watermarkRequired).toBe(false)
  })

  it('DLP mask 允许水印', () => {
    const decision = wmBuildMaskDecision()
    const formatMatrix = buildFormatMatrix()
    const formatSupport: Partial<
      Record<
        WatermarkFormat,
        {
          level: WatermarkFormatSupportLevel
          strategy: string
          warningCode: WatermarkWarningCode | null
        }
      >
    > = {}
    for (const entry of formatMatrix) {
      formatSupport[entry.format] = {
        level: entry.level,
        strategy: entry.strategy,
        warningCode: entry.warningCode,
      }
    }

    const followUp = resolveWatermarkFollowUp({
      dlpResult: decision.result,
      format: 'markdown',
      formatSupport: formatSupport as Partial<
        Record<
          WatermarkFormat,
          {
            level: WatermarkFormatSupportLevel
            strategy: string
            warningCode: WatermarkWarningCode | null
          }
        >
      >,
      policyEnabled: true,
      blockUnsupported: false,
    })
    expect(followUp.watermarkRequired).toBe(true)
  })

  it('不支持格式且 blockUnsupported=true 时返回无水印', () => {
    const decision = wmBuildAllowDecision()
    const followUp = resolveWatermarkFollowUp({
      dlpResult: decision.result,
      format: 'unsupported',
      formatSupport: {},
      policyEnabled: true,
      blockUnsupported: true,
    })
    expect(followUp.watermarkRequired).toBe(false)
    expect(followUp.warningCodes).toContain('WM_FORMAT_UNSUPPORTED')
  })
})

describe('水印共享契约 — 格式支持', () => {
  it('isFormatRenderable 对 native 返回 true', () => {
    expect(isFormatRenderable('native')).toBe(true)
  })

  it('isFormatRenderable 对 degraded 返回 true', () => {
    expect(isFormatRenderable('degraded')).toBe(true)
  })

  it('isFormatRenderable 对 unsupported 返回 false', () => {
    expect(isFormatRenderable('unsupported')).toBe(false)
  })

  it('buildFormatMatrix 包含所有 5 种格式', () => {
    const matrix = buildFormatMatrix()
    expect(matrix).toHaveLength(5)
    const formats = matrix.map((e) => e.format)
    expect(formats).toContain('markdown')
    expect(formats).toContain('csv')
    expect(formats).toContain('html')
    expect(formats).toContain('pdf')
    expect(formats).toContain('unsupported')
  })

  it('native 格式支持可见水印', () => {
    for (const format of WATERMARK_NATIVE_FORMATS) {
      const entry = buildFormatMatrixEntry({ format })
      expect(entry.visibleSupported).toBe(true)
    }
  })

  it('unsupported 格式不可渲染', () => {
    const entry = buildUnsupportedFormatEntry()
    expect(entry.visibleSupported).toBe(false)
    expect(entry.metadataSupported).toBe(false)
    expect(entry.level).toBe('unsupported')
  })

  it('getFormatSupportLevel 返回正确的级别', () => {
    const matrix = buildFormatMatrix()
    const formatSupport: Partial<
      Record<
        WatermarkFormat,
        {
          level: WatermarkFormatSupportLevel
          strategy: string
          warningCode: WatermarkWarningCode | null
        }
      >
    > = {}
    for (const entry of matrix) {
      formatSupport[entry.format] = {
        level: entry.level,
        strategy: entry.strategy,
        warningCode: entry.warningCode,
      }
    }

    expect(getFormatSupportLevel('markdown', formatSupport as any)).toBe('native')
    expect(getFormatSupportLevel('unsupported', formatSupport as any)).toBe('unsupported')
    expect(getFormatSupportLevel('pdf', formatSupport as any)).toBe('native')
  })

  it('getFormatSupportLevel 对未知格式返回 unsupported', () => {
    expect(getFormatSupportLevel('excel' as WatermarkFormat, {})).toBe('unsupported')
  })
})

describe('水印共享契约 — 低敏 payload', () => {
  it('buildWatermarkPayload 不包含原始内容', () => {
    const payload = buildWatermarkPayloadFixture()
    expect(payload.watermarkId).toBeDefined()
    expect(payload.watermarkHash).toBeDefined()
    expect(payload.payloadHash).toBeDefined()
    // 不应包含原始敏感字段
    expect((payload as any).sourceContent).toBeUndefined()
    expect((payload as any).prompt).toBeUndefined()
    expect((payload as any).rawOcrText).toBeUndefined()
  })

  it('payload 中的 ID 都是 hash 值', () => {
    const payload = buildWatermarkPayloadFixture()
    expect(payload.organizationIdHash).toMatch(/^[0-9a-f]{8}$/)
    expect(payload.actorIdHash).toMatch(/^[0-9a-f]{8}$/)
    expect(payload.projectIdHash).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('水印共享契约 — 审计元数据脱敏', () => {
  it('redactWatermarkMetadata 脱敏禁止键', () => {
    const metadata = {
      format: 'markdown',
      mode: 'visible',
      password: 'supersecret',
      apiKey: 'sk-xxx',
      sourceContent: 'file content',
      planHash: 'abc123',
    }
    const redacted = redactWatermarkMetadata(metadata)
    expect(redacted.format).toBe('markdown')
    expect(redacted.password).toBe('[REDACTED]')
    expect(redacted.apiKey).toBe('[REDACTED]')
    expect(redacted.sourceContent).toBe('[REDACTED]')
    expect(redacted.planHash).toBe('abc123')
  })

  it('redactWatermarkMetadata 大小写不敏感', () => {
    const metadata = { Password: 'secret', APIKEY: 'sk-xxx' }
    const redacted = redactWatermarkMetadata(metadata)
    expect(redacted.Password).toBe('[REDACTED]')
    expect(redacted.APIKEY).toBe('[REDACTED]')
  })

  it('redactWatermarkMetadata 对空对象不报错', () => {
    expect(redactWatermarkMetadata({})).toEqual({})
  })
})

describe('水印共享契约 — 过期检测', () => {
  it('isWatermarkPlanExpired 对将来时间返回 false', () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    expect(isWatermarkPlanExpired(future)).toBe(false)
  })

  it('isWatermarkPlanExpired 对过去时间返回 true', () => {
    const past = new Date(Date.now() - 3600_000).toISOString()
    expect(isWatermarkPlanExpired(past)).toBe(true)
  })
})

describe('水印共享契约 — 重复 warning 排序', () => {
  it('sortWatermarkWarnings 去重并排序', () => {
    const result = sortWatermarkWarnings(['WM_PLAN_EXPIRED', 'WM_POLICY_STALE', 'WM_PLAN_EXPIRED'])
    expect(result).toEqual(['WM_PLAN_EXPIRED', 'WM_POLICY_STALE'])
  })

  it('sortWatermarkWarnings 对空数组返回空数组', () => {
    expect(sortWatermarkWarnings([])).toEqual([])
  })
})

describe('水印共享契约 — fixture 构造器', () => {
  it('buildWatermarkPolicySummary 产生有效策略摘要', () => {
    const summary = buildWatermarkPolicySummary()
    expect(summary.policyHash).toBeTruthy()
    expect(summary.enabledPolicies).toContain('watermark_visible')
    expect(summary.templateHash).toBeTruthy()
  })

  it('buildStrictWatermarkPolicy 启用两种策略', () => {
    const summary = buildStrictWatermarkPolicy()
    expect(summary.enabledPolicies).toContain('watermark_visible')
    expect(summary.enabledPolicies).toContain('watermark_metadata')
  })

  it('buildWatermarkPlan 产生有效 plan', () => {
    const plan = buildWatermarkPlan()
    expect(plan.planHash).toBeTruthy()
    expect(plan.watermarkHash).toBeTruthy()
    expect(plan.payloadHash).toBeTruthy()
    expect(plan.format).toBe('markdown')
    expect(plan.mode).toBe('visible')
    expect(plan.warningCodes).toEqual([])
  })

  it('buildStaleWatermarkPlan 包含过期 warning', () => {
    const plan = buildStaleWatermarkPlan()
    expect(plan.warningCodes).toContain('WM_PLAN_EXPIRED')
    expect(isWatermarkPlanExpired(plan.expiresAt)).toBe(true)
  })

  it('buildRenderSuccessResult 产生成功结果', () => {
    const result = buildRenderSuccessResult()
    expect(result.result).toBe('success')
    expect(result.outputHash).toBeTruthy()
    expect(result.payload).not.toBeNull()
  })

  it('buildRenderDegradedResult 产生降级结果', () => {
    const result = buildRenderDegradedResult()
    expect(result.result).toBe('degraded')
    expect(result.payload).toBeNull()
    expect(result.warningCodes).toContain('WM_FORMAT_UNSUPPORTED')
  })

  it('buildRenderBlockedResult 产生阻断结果', () => {
    const result = buildRenderBlockedResult()
    expect(result.result).toBe('blocked')
    expect(result.outputHash).toBeNull()
    expect(result.payload).toBeNull()
  })

  it('buildWatermarkLedgerEvent 产生有效事件', () => {
    const event = buildWatermarkLedgerEvent()
    expect(event.id).toBe(1)
    expect(event.eventType).toBe('render_success')
    expect(event.planHash).toBeTruthy()
  })

  it('buildCrossOrganizationDenialEvent 包含跨组织 warning', () => {
    const event = buildCrossOrganizationDenialEvent()
    expect(event.warningCodes).toContain('WM_CROSS_ORGANIZATION_DENIED')
    expect(event.eventType).toBe('permission_denied')
  })

  it('buildWatermarkPreviewRequest 产生有效预览请求', () => {
    const req = buildWatermarkPreviewRequest()
    expect(req.template).toContain('{{user_display}}')
    expect(req.templateVariables.user_display).toBe('user_abc')
  })

  it('buildWatermarkPreviewResult 产生有效预览结果', () => {
    const result = buildWatermarkPreviewResult()
    expect(result.previewHash).toBeTruthy()
    expect(result.renderedPreview).toBe('user_abc — 2026-08-04')
  })

  it('buildWatermarkVerificationResult 验证通过', () => {
    const result = buildWatermarkVerificationResult()
    expect(result.status).toBe('verified')
  })

  it('buildTamperedVerificationResult 验证失败', () => {
    const result = buildTamperedVerificationResult()
    expect(result.status).toBe('tampered')
    expect(result.reasonCodes).toContain('SOURCE_HASH_MISMATCH')
  })

  it('buildEmptyEventList 返回空数组', () => {
    expect(buildEmptyEventList()).toEqual([])
  })

  it('buildEventList 返回 5 个事件', () => {
    const events = buildEventList()
    expect(events).toHaveLength(5)
  })

  it('buildDefaultWatermarkStyle 返回默认样式', () => {
    const style = buildDefaultWatermarkStyle()
    expect(style.opacity).toBe(0.3)
    expect(style.fontSize).toBe(12)
    expect(style.position).toBe('footer')
  })
})

describe('水印共享契约 — 常量完整性', () => {
  it('WATERMARK_POLICY_IDS 包含所有策略 ID', () => {
    expect(WATERMARK_POLICY_IDS).toContain('watermark_visible')
    expect(WATERMARK_POLICY_IDS).toContain('watermark_metadata')
    expect(WATERMARK_POLICY_IDS).toContain('watermark_invisible')
  })

  it('WATERMARK_MODES 包含所有模式', () => {
    expect(WATERMARK_MODES).toContain('visible')
    expect(WATERMARK_MODES).toContain('invisible')
    expect(WATERMARK_MODES).toContain('metadata')
  })

  it('WATERMARK_FORMATS 包含所有格式', () => {
    expect(WATERMARK_FORMATS).toContain('markdown')
    expect(WATERMARK_FORMATS).toContain('csv')
    expect(WATERMARK_FORMATS).toContain('html')
    expect(WATERMARK_FORMATS).toContain('pdf')
    expect(WATERMARK_FORMATS).toContain('unsupported')
  })

  it('WATERMARK_EVENT_TYPES 包含所有事件类型', () => {
    expect(WATERMARK_EVENT_TYPES.length).toBeGreaterThanOrEqual(12)
  })

  it('WATERMARK_WARNING_CODES 包含所有 warning code', () => {
    expect(WATERMARK_WARNING_CODES).toContain('WM_POLICY_STALE')
    expect(WATERMARK_WARNING_CODES).toContain('WM_PLAN_EXPIRED')
    expect(WATERMARK_WARNING_CODES).toContain('WM_ADAPTER_UNAVAILABLE')
    expect(WATERMARK_WARNING_CODES).toContain('WM_FORMAT_UNSUPPORTED')
    expect(WATERMARK_WARNING_CODES).toContain('WM_STYLE_BOUND_EXCEEDED')
  })

  it('WATERMARK_APPROVED_TEMPLATE_VARIABLES 包含所有已批准变量', () => {
    expect(WATERMARK_APPROVED_TEMPLATE_VARIABLES).toContain('user_display')
    expect(WATERMARK_APPROVED_TEMPLATE_VARIABLES).toContain('user_id_hash')
    expect(WATERMARK_APPROVED_TEMPLATE_VARIABLES).toContain('organization_id_hash')
    expect(WATERMARK_APPROVED_TEMPLATE_VARIABLES).toContain('watermark_id')
    expect(WATERMARK_APPROVED_TEMPLATE_VARIABLES).not.toContain('source_path')
    expect(WATERMARK_APPROVED_TEMPLATE_VARIABLES).not.toContain('prompt')
  })

  it('WATERMARK_FORBIDDEN_KEYS 包含所有禁止键', () => {
    expect(WATERMARK_FORBIDDEN_KEYS).toContain('password')
    expect(WATERMARK_FORBIDDEN_KEYS).toContain('prompt')
    expect(WATERMARK_FORBIDDEN_KEYS).toContain('sourceContent')
    expect(WATERMARK_FORBIDDEN_KEYS).toContain('rawOcrText')
    expect(WATERMARK_FORBIDDEN_KEYS).toContain('absolutePath')
  })

  it('WATERMARK_NATIVE_FORMATS 包含 4 种原生格式', () => {
    expect(WATERMARK_NATIVE_FORMATS).toHaveLength(4)
    expect(WATERMARK_NATIVE_FORMATS).toContain('markdown')
    expect(WATERMARK_NATIVE_FORMATS).toContain('csv')
    expect(WATERMARK_NATIVE_FORMATS).toContain('html')
    expect(WATERMARK_NATIVE_FORMATS).toContain('pdf')
  })
})

describe('水印共享契约 — 无依赖导入', () => {
  it('核心类型可直接导入使用', () => {
    const policyId: WatermarkPolicyId = 'watermark_visible'
    const format: WatermarkFormat = 'markdown'
    const mode = 'visible' as const
    expect(isWatermarkPolicyId(policyId)).toBe(true)
    expect(isWatermarkFormat(format)).toBe(true)
    expect(isWatermarkMode(mode)).toBe(true)
  })

  it('常量可在无运行时依赖下使用', () => {
    expect(WATERMARK_PLAN_TTL_SECONDS).toBeGreaterThan(0)
    expect(WATERMARK_PREVIEW_TTL_SECONDS).toBeGreaterThan(0)
  })

  it('buildDefaultWatermarkPolicySummary 不依赖外部运行时', () => {
    const summary = buildDefaultWatermarkPolicySummary()
    expect(summary.policyHash).toBeTruthy()
    expect(summary.enabledPolicies.length).toBeGreaterThan(0)
  })
})
