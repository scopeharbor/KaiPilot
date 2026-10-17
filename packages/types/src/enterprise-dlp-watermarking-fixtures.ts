/**
 * v3-enterprise-dlp-watermarking — 企业级 DLP 水印测试夹具（前后端共享）。
 *
 * 提供 policies、DLP decisions、plans、payloads、render results、ledger events、
 * unsupported formats、stale plans 和跨组织拒绝场景的构造器。
 */

import type {
  WatermarkFormat,
  WatermarkFormatSupport,
  WatermarkFormatSupportLevel,
  WatermarkPolicySummary,
  WatermarkPlan,
  WatermarkPayload,
  WatermarkRenderRecord,
  WatermarkLedgerEvent,
  WatermarkWarningCode,
  WatermarkPreviewRequest,
  WatermarkPreviewResult,
  WatermarkFormatMatrixEntry,
  WatermarkVerificationResult,
} from './enterprise-dlp-watermarking.js'
import {
  computeWatermarkPolicyHash,
  computeWatermarkTemplateHash,
  computeWatermarkPlanHash,
  computeWatermarkPayloadHash,
  computeWatermarkHash,
  computeWatermarkPreviewHash,
  computeRenderedTextHash,
  buildDefaultWatermarkStyle,
  buildFormatMatrix,
  fnv1aHash,
} from './enterprise-dlp-watermarking.js'

// ─── 构造器 ────────────────────────────────────────────────────────────────────────

export function buildWatermarkPolicySummary(
  overrides?: Partial<WatermarkPolicySummary>,
): WatermarkPolicySummary {
  const formatMatrix = buildFormatMatrix()
  const formatSupport: Partial<Record<WatermarkFormat, WatermarkFormatSupport>> = {}
  for (const entry of formatMatrix) {
    formatSupport[entry.format] = {
      level: entry.level,
      strategy: entry.strategy,
      warningCode: entry.warningCode,
    }
  }

  const template = '{{user_display}} — {{organization_id_hash}} — {{exported_at}}'
  const templateHash = computeWatermarkTemplateHash(template)

  const base: WatermarkPolicySummary = {
    policyHash: '',
    enabledPolicies: ['watermark_visible'],
    policyModes: { watermark_visible: 'visible' },
    formatMatrix: formatSupport,
    defaultTemplate: template,
    templateHash,
    warningCodes: [],
  }

  base.policyHash = computeWatermarkPolicyHash({
    enabledPolicies: base.enabledPolicies,
    policyModes: base.policyModes,
    template: base.defaultTemplate,
    style: buildDefaultWatermarkStyle(),
    formatSupport: base.formatMatrix,
    organizationId: 0,
  })

  return { ...base, ...overrides }
}

export function buildStrictWatermarkPolicy(
  overrides?: Partial<WatermarkPolicySummary>,
): WatermarkPolicySummary {
  const formatMatrix = buildFormatMatrix({
    unsupported: {
      level: 'unsupported' as WatermarkFormatSupportLevel,
      strategy: 'block',
      warningCode: 'WM_FORMAT_UNSUPPORTED' as WatermarkWarningCode,
    },
  })
  const formatSupport: Partial<Record<WatermarkFormat, WatermarkFormatSupport>> = {}
  for (const entry of formatMatrix) {
    formatSupport[entry.format] = {
      level: entry.level,
      strategy: entry.strategy,
      warningCode: entry.warningCode,
    }
  }

  const template = '{{user_display}} — {{exported_at}}'
  const templateHash = computeWatermarkTemplateHash(template)

  const base: WatermarkPolicySummary = {
    policyHash: '',
    enabledPolicies: ['watermark_visible', 'watermark_metadata'],
    policyModes: { watermark_visible: 'visible', watermark_metadata: 'metadata' },
    formatMatrix: formatSupport,
    defaultTemplate: template,
    templateHash,
    warningCodes: [],
  }

  base.policyHash = computeWatermarkPolicyHash({
    enabledPolicies: base.enabledPolicies,
    policyModes: base.policyModes,
    template: base.defaultTemplate,
    style: buildDefaultWatermarkStyle(),
    formatSupport: base.formatMatrix,
    organizationId: 0,
  })

  return { ...base, ...overrides }
}

export function buildDLPDecisionSnapshot(result: string): {
  result: string
  decisionHash: string
  sourceHash: string
  policyHash: string
} {
  const sourceHash = fnv1aHash('source-ref:v1')
  const policyHash = fnv1aHash('policy:v1')
  const decisionHash = fnv1aHash(`${result}:${sourceHash}:${policyHash}`)
  return { result, decisionHash, sourceHash, policyHash }
}

export function wmBuildBlockDecision(): {
  result: string
  decisionHash: string
  sourceHash: string
  policyHash: string
} {
  return buildDLPDecisionSnapshot('block')
}

export function wmBuildAllowDecision(): {
  result: string
  decisionHash: string
  sourceHash: string
  policyHash: string
} {
  return buildDLPDecisionSnapshot('allow')
}

export function wmBuildMaskDecision(): {
  result: string
  decisionHash: string
  sourceHash: string
  policyHash: string
} {
  return buildDLPDecisionSnapshot('mask')
}

export function wmBuildConfirmRequiredDecision(): {
  result: string
  decisionHash: string
  sourceHash: string
  policyHash: string
} {
  return buildDLPDecisionSnapshot('warn_confirm')
}

export function buildWatermarkPlan(overrides?: Partial<WatermarkPlan>): WatermarkPlan {
  const style = buildDefaultWatermarkStyle()
  const templateVariables: Partial<Record<string, string>> = {
    user_display: 'user_abc',
    organization_id_hash: fnv1aHash('org_1'),
    exported_at: '2026-08-04T00:00:00.000Z',
  }
  const sourceHash = fnv1aHash('report:v1')
  const policyHash = fnv1aHash('policy:v1')
  const decisionHash = fnv1aHash('allow:report:v1')
  const templateHash = computeWatermarkTemplateHash(
    '{{user_display}} — {{organization_id_hash}} — {{exported_at}}',
  )

  const planHash = computeWatermarkPlanHash({
    actorId: 1,
    organizationId: 1,
    projectId: 1,
    action: 'export',
    sourceHash,
    policyHash,
    decisionHash,
    format: 'markdown',
    mode: 'visible',
  })

  const watermarkId = `wm_${fnv1aHash('plan:1')}`
  const payloadHash = computeWatermarkPayloadHash({
    watermarkId,
    planHash,
    decisionHash,
    sourceHash,
  })

  const renderedText = 'user_abc — org_hash — 2026-08-04'
  const renderedTextHash = computeRenderedTextHash(renderedText)
  const watermarkHash = computeWatermarkHash({
    planHash,
    payloadHash,
    renderedTextHash,
  })

  const base: WatermarkPlan = {
    planId: `plan_${fnv1aHash('plan:1')}`,
    planHash,
    actorId: 1,
    organizationId: 1,
    projectId: 1,
    action: 'export',
    sourceRef: 'report:1',
    sourceHash,
    policyHash,
    policyTemplateHash: templateHash,
    decisionHash,
    format: 'markdown',
    mode: 'visible',
    template: '{{user_display}} — {{organization_id_hash}} — {{exported_at}}',
    templateVariables,
    style,
    watermarkHash,
    payloadHash,
    warningCodes: [],
    requiresConfirmation: false,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    createdAt: new Date().toISOString(),
  }

  return { ...base, ...overrides }
}

export function buildStaleWatermarkPlan(overrides?: Partial<WatermarkPlan>): WatermarkPlan {
  const base = buildWatermarkPlan({
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    warningCodes: ['WM_PLAN_EXPIRED' as WatermarkWarningCode],
    ...overrides,
  })
  return base
}

export function buildWatermarkPayloadFixture(
  overrides?: Partial<WatermarkPayload>,
): WatermarkPayload {
  const planHash = fnv1aHash('plan:1')
  const decisionHash = fnv1aHash('decision:1')
  const sourceHash = fnv1aHash('source:1')
  const watermarkId = `wm_${fnv1aHash('fixture:1')}`
  const payloadHash = computeWatermarkPayloadHash({
    watermarkId,
    planHash,
    decisionHash,
    sourceHash,
  })
  const renderedTextHash = fnv1aHash('rendered:fixture')
  const watermarkHash = computeWatermarkHash({
    planHash,
    payloadHash,
    renderedTextHash,
  })

  return {
    watermarkId,
    watermarkHash,
    payloadHash,
    planHash,
    decisionHash,
    policyHash: fnv1aHash('policy:1'),
    sourceHash,
    organizationIdHash: fnv1aHash('1'),
    actorIdHash: fnv1aHash('1'),
    projectIdHash: fnv1aHash('1'),
    format: 'markdown',
    mode: 'visible',
    renderedTextHash,
    warningCodes: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildRenderSuccessResult(
  overrides?: Partial<WatermarkRenderRecord>,
): WatermarkRenderRecord {
  const planHash = fnv1aHash('plan:1')
  const payload = buildWatermarkPayloadFixture()
  return {
    planHash,
    result: 'success',
    outputHash: fnv1aHash('output:1'),
    payload,
    warningCodes: [],
    renderedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildRenderDegradedResult(
  overrides?: Partial<WatermarkRenderRecord>,
): WatermarkRenderRecord {
  const planHash = fnv1aHash('plan:1')
  return {
    planHash,
    result: 'degraded',
    outputHash: fnv1aHash('output:degraded'),
    payload: null,
    warningCodes: ['WM_FORMAT_UNSUPPORTED' as WatermarkWarningCode],
    renderedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildRenderBlockedResult(
  overrides?: Partial<WatermarkRenderRecord>,
): WatermarkRenderRecord {
  const planHash = fnv1aHash('plan:1')
  return {
    planHash,
    result: 'blocked',
    outputHash: null,
    payload: null,
    warningCodes: ['WM_PLAN_EXPIRED' as WatermarkWarningCode],
    renderedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildWatermarkLedgerEvent(
  overrides?: Partial<WatermarkLedgerEvent>,
): WatermarkLedgerEvent {
  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    eventType: 'render_success',
    format: 'markdown',
    mode: 'visible',
    // ledger 事件的 result 是状态联合，不是整条渲染记录
    result: 'success',
    planHash: fnv1aHash('plan:1'),
    policyHash: fnv1aHash('policy:1'),
    sourceHash: fnv1aHash('source:1'),
    decisionHash: fnv1aHash('decision:1'),
    watermarkHash: fnv1aHash('watermark:1'),
    warningCodes: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildCrossOrganizationDenialEvent(
  overrides?: Partial<WatermarkLedgerEvent>,
): WatermarkLedgerEvent {
  return {
    id: 2,
    organizationId: 1,
    projectId: 2,
    actorId: 2,
    eventType: 'permission_denied',
    format: null,
    mode: null,
    result: null,
    planHash: null,
    policyHash: null,
    sourceHash: null,
    decisionHash: null,
    watermarkHash: null,
    warningCodes: ['WM_CROSS_ORGANIZATION_DENIED' as WatermarkWarningCode],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildWatermarkPreviewRequest(
  overrides?: Partial<WatermarkPreviewRequest>,
): WatermarkPreviewRequest {
  return {
    template: '{{user_display}} — {{exported_at}}',
    templateVariables: {
      user_display: 'user_abc',
      exported_at: '2026-08-04T00:00:00.000Z',
    },
    style: buildDefaultWatermarkStyle(),
    format: 'markdown',
    mode: 'visible',
    ...overrides,
  }
}

export function buildWatermarkPreviewResult(
  overrides?: Partial<WatermarkPreviewResult>,
): WatermarkPreviewResult {
  const req = buildWatermarkPreviewRequest()
  const previewHash = computeWatermarkPreviewHash({
    template: req.template,
    templateVariables: req.templateVariables,
    style: req.style,
    format: req.format,
    mode: req.mode,
  })

  return {
    previewHash,
    renderedPreview: 'user_abc — 2026-08-04',
    variableWarnings: [],
    styleWarnings: [],
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  }
}

export function buildFormatMatrixEntry(
  overrides?: Partial<WatermarkFormatMatrixEntry>,
): WatermarkFormatMatrixEntry {
  return {
    format: 'markdown',
    level: 'native',
    strategy: 'header_footer_block',
    visibleSupported: true,
    metadataSupported: true,
    warningCode: null,
    ...overrides,
  }
}

export function buildUnsupportedFormatEntry(): WatermarkFormatMatrixEntry {
  return {
    format: 'unsupported',
    level: 'unsupported',
    strategy: 'block_or_warn',
    visibleSupported: false,
    metadataSupported: false,
    warningCode: 'WM_FORMAT_UNSUPPORTED' as WatermarkWarningCode,
  }
}

export function buildWatermarkVerificationResult(
  overrides?: Partial<WatermarkVerificationResult>,
): WatermarkVerificationResult {
  return {
    status: 'verified',
    watermarkHash: fnv1aHash('watermark:1'),
    sourceHash: fnv1aHash('source:1'),
    planHash: fnv1aHash('plan:1'),
    payloadHash: fnv1aHash('payload:1'),
    decisionHash: fnv1aHash('decision:1'),
    matchedAt: new Date().toISOString(),
    reasonCodes: [],
    ...overrides,
  }
}

export function buildTamperedVerificationResult(
  overrides?: Partial<WatermarkVerificationResult>,
): WatermarkVerificationResult {
  return {
    status: 'tampered',
    watermarkHash: fnv1aHash('watermark:1'),
    sourceHash: fnv1aHash('source:2'),
    planHash: fnv1aHash('plan:1'),
    payloadHash: null,
    decisionHash: null,
    matchedAt: null,
    reasonCodes: ['SOURCE_HASH_MISMATCH', 'PAYLOAD_NOT_FOUND'],
    ...overrides,
  }
}

export function buildEmptyEventList(): WatermarkLedgerEvent[] {
  return []
}

export function buildEventList(): WatermarkLedgerEvent[] {
  return [
    buildWatermarkLedgerEvent({ id: 1, eventType: 'render_success' }),
    buildWatermarkLedgerEvent({
      id: 2,
      eventType: 'render_degraded',
      format: 'unsupported',
      warningCodes: ['WM_FORMAT_UNSUPPORTED' as WatermarkWarningCode],
    }),
    buildWatermarkLedgerEvent({
      id: 3,
      eventType: 'permission_denied',
      format: null,
      mode: null,
      result: null,
      planHash: null,
      policyHash: null,
      sourceHash: null,
      decisionHash: null,
      watermarkHash: null,
      warningCodes: ['WM_PERMISSION_DENIED' as WatermarkWarningCode],
    }),
    buildWatermarkLedgerEvent({ id: 4, eventType: 'plan_created' }),
    buildWatermarkLedgerEvent({
      id: 5,
      eventType: 'plan_expired',
      result: null,
      warningCodes: ['WM_PLAN_EXPIRED' as WatermarkWarningCode],
    }),
  ]
}
