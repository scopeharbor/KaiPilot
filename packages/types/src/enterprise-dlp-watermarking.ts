/**
 * v3-enterprise-dlp-watermarking — 企业级 DLP 水印共享契约（前后端共享）。
 *
 * 定义水印策略 ID、规则 ID、模式、格式、格式支持级别、模板变量、
 * 样式边界、plan、payload、render 结果、ledger 事件与 warning code。
 *
 * 设计原则：
 * - 全部纯函数，零运行时依赖。
 * - 稳定排序：涉及 hash 的计算都对对象 key 做稳定排序。
 * - 禁止键检测 fail closed：未经显式允许的 field name 不被泄露。
 * - 所有 hash/签名使用稳定 FNV-1a 变体（与 DLP engine 共享 fnv1aHash），确保跨运行时确定性。
 * - 所有 warning 聚合按 severity 排序，确保 UI 一致性。
 */

import { fnv1aHash, computeStableSignature } from './enterprise-dlp-engine.js'

// 仅重新导出 fnv1aHash（fixtures 和测试依赖它）。
// 不重新导出 computeStableSignature —— 它已由 enterprise-dlp-engine 通过 barrel 导出。
export { fnv1aHash }

// ─── 枚举 ──────────────────────────────────────────────────────────────────────────

/** 水印策略 ID */
export type WatermarkPolicyId = 'watermark_visible' | 'watermark_metadata' | 'watermark_invisible'

/** 水印规则 ID */
export type WatermarkRuleId =
  | 'wm_report_export'
  | 'wm_file_download'
  | 'wm_ocr_copy_export'
  | 'wm_ai_context_marker'
  | 'wm_preview_watermark'

/** 水印模式 */
export type WatermarkMode = 'visible' | 'invisible' | 'metadata'

/** 水印格式 */
export type WatermarkFormat = 'markdown' | 'csv' | 'html' | 'pdf' | 'unsupported'

/** 水印格式支持级别 */
export type WatermarkFormatSupportLevel = 'native' | 'degraded' | 'unsupported'

/**
 * 水印策略作用域。
 *
 * 只有全局与组织两级。**没有项目级**：`DlpWatermarkPolicy` 的
 * `view()` / `manage()` 全部只接受 `organizationId`，租户中间件也只把水印端点
 * 解析到组织租户上，项目级作用域没有任何判定路径能读到它——留着只会让
 * 写入方以为存在一层其实不生效的收紧。
 */
export type WatermarkPolicyScope = 'global' | 'organization'

/** 水印状态 */
export type WatermarkStatus = 'active' | 'inactive' | 'error'

/** 水印渲染结果 */
export type WatermarkRenderResult = 'success' | 'degraded' | 'blocked' | 'skipped' | 'error'

/** 水印事件类型 */
export type WatermarkEventType =
  | 'policy_update'
  | 'plan_created'
  | 'plan_previewed'
  | 'render_success'
  | 'render_degraded'
  | 'render_blocked'
  | 'plan_expired'
  | 'adapter_unavailable'
  | 'permission_denied'
  | 'verification_lookup'
  | 'format_unsupported'
  | 'stale_source_blocked'

/** 水印警告代码 */
export type WatermarkWarningCode =
  | 'WM_POLICY_STALE'
  | 'WM_PLAN_EXPIRED'
  | 'WM_ADAPTER_UNAVAILABLE'
  | 'WM_FORMAT_UNSUPPORTED'
  | 'WM_PERMISSION_DENIED'
  | 'WM_CROSS_ORGANIZATION_DENIED'
  | 'WM_STALE_SOURCE'
  | 'WM_REDACTED_EVENT_DETAILS'
  | 'WM_METADATA_REDACTION_FAILED'
  | 'WM_INVALID_TEMPLATE_VARIABLE'
  | 'WM_STYLE_BOUND_EXCEEDED'
  // DLP 判定为 block 时的水印 follow-up 结果码。与 WM_FORMAT_UNSUPPORTED 区分开：
  // 前者是「内容本身不许外发」，后者是「内容可外发但打不上水印」，两种情况下
  // 调用方给用户的提示和可选动作完全不同。
  | 'WM_DLP_BLOCKED'
  // 格式不支持、但策略配置为 allow_with_warning：导出照常进行，只是没有水印。
  // 与 WM_FORMAT_UNSUPPORTED（同样不支持但被拦停）成对出现，靠 code 而非
  // canProceed 单独判断也能区分降级与阻断。
  | 'WM_FORMAT_UNSUPPORTED_WARN'

/** 水印验证状态 */
export type WatermarkVerificationStatus = 'verified' | 'tampered' | 'unverifiable' | 'expired'

/** 水印确认状态 */
export type WatermarkConfirmationStatus = 'pending' | 'confirmed' | 'expired' | 'stale' | 'rejected'

// ─── 常量 ──────────────────────────────────────────────────────────────────────────

export const WATERMARK_POLICY_IDS: readonly WatermarkPolicyId[] = [
  'watermark_visible',
  'watermark_metadata',
  'watermark_invisible',
] as const

export const WATERMARK_RULE_IDS: readonly WatermarkRuleId[] = [
  'wm_report_export',
  'wm_file_download',
  'wm_ocr_copy_export',
  'wm_ai_context_marker',
  'wm_preview_watermark',
] as const

export const WATERMARK_MODES: readonly WatermarkMode[] = [
  'visible',
  'invisible',
  'metadata',
] as const

export const WATERMARK_FORMATS: readonly WatermarkFormat[] = [
  'markdown',
  'csv',
  'html',
  'pdf',
  'unsupported',
] as const

export const WATERMARK_FORMAT_SUPPORT_LEVELS: readonly WatermarkFormatSupportLevel[] = [
  'native',
  'degraded',
  'unsupported',
] as const

export const WATERMARK_POLICY_SCOPES: readonly WatermarkPolicyScope[] = [
  'global',
  'organization',
] as const

export const WATERMARK_STATUSES: readonly WatermarkStatus[] = [
  'active',
  'inactive',
  'error',
] as const

export const WATERMARK_RENDER_RESULTS: readonly WatermarkRenderResult[] = [
  'success',
  'degraded',
  'blocked',
  'skipped',
  'error',
] as const

export const WATERMARK_EVENT_TYPES: readonly WatermarkEventType[] = [
  'policy_update',
  'plan_created',
  'plan_previewed',
  'render_success',
  'render_degraded',
  'render_blocked',
  'plan_expired',
  'adapter_unavailable',
  'permission_denied',
  'verification_lookup',
  'format_unsupported',
  'stale_source_blocked',
] as const

export const WATERMARK_WARNING_CODES: readonly WatermarkWarningCode[] = [
  'WM_POLICY_STALE',
  'WM_PLAN_EXPIRED',
  'WM_ADAPTER_UNAVAILABLE',
  'WM_FORMAT_UNSUPPORTED',
  'WM_PERMISSION_DENIED',
  'WM_CROSS_ORGANIZATION_DENIED',
  'WM_STALE_SOURCE',
  'WM_REDACTED_EVENT_DETAILS',
  'WM_METADATA_REDACTION_FAILED',
  'WM_INVALID_TEMPLATE_VARIABLE',
  'WM_STYLE_BOUND_EXCEEDED',
  'WM_DLP_BLOCKED',
  'WM_FORMAT_UNSUPPORTED_WARN',
] as const

export const WATERMARK_VERIFICATION_STATUSES: readonly WatermarkVerificationStatus[] = [
  'verified',
  'tampered',
  'unverifiable',
  'expired',
] as const

export const WATERMARK_CONFIRMATION_STATUSES: readonly WatermarkConfirmationStatus[] = [
  'pending',
  'confirmed',
  'expired',
  'stale',
  'rejected',
] as const

/** 水印 plan TTL（秒） */
export const WATERMARK_PLAN_TTL_SECONDS = 600

/** 水印预览 TTL（秒） */
export const WATERMARK_PREVIEW_TTL_SECONDS = 300

/** 最大水印文本长度（字符） */
export const WATERMARK_MAX_TEXT_LENGTH = 500

/** 最大水印重复次数 */
export const WATERMARK_MAX_REPEAT_COUNT = 50

/** 水印不透明度下限 */
export const WATERMARK_OPACITY_MIN = 0.05

/** 水印不透明度上限 */
export const WATERMARK_OPACITY_MAX = 1.0

/** 水印字体大小下限（pt） */
export const WATERMARK_FONT_SIZE_MIN = 6

/** 水印字体大小上限（pt） */
export const WATERMARK_FONT_SIZE_MAX = 72

/** 水印旋转角度下限（度） */
export const WATERMARK_ROTATION_MIN = -90

/** 水印旋转角度上限（度） */
export const WATERMARK_ROTATION_MAX = 90

/** 事件列表每页最大条数 */
export const WATERMARK_EVENT_MAX_PER_PAGE = 100

/** 事件列表默认每页条数 */
export const WATERMARK_EVENT_DEFAULT_PER_PAGE = 20

/** 已批准的模板变量白名单 */
export const WATERMARK_APPROVED_TEMPLATE_VARIABLES: readonly string[] = [
  'user_display',
  'user_id_hash',
  'organization_id_hash',
  'project_id_hash',
  'source_type',
  'source_id_hash',
  'exported_at',
  'request_id_hash',
  'classification',
  'watermark_id',
] as const

/** 禁止出现在水印输出中的键（这些键的原始值绝不进入水印 payload 或 ledger） */
export const WATERMARK_FORBIDDEN_KEYS: readonly string[] = [
  'password',
  'passwordHash',
  'token',
  'apiKey',
  'secret',
  'authorization',
  'prompt',
  'modelOutput',
  'sourceContent',
  'sourcePath',
  'absolutePath',
  'rawOcrText',
  'reportBody',
  'fileContent',
] as const

/**
 * 允许出现在水印 metadata 中的键（白名单）。
 *
 * 为什么不能只靠 `WATERMARK_FORBIDDEN_KEYS` 黑名单：黑名单永远列不全。
 * 本仓库里就有现成的例子——黑名单写了 `sourceContent` 和 `rawOcrText`，
 * 但适配器实际传的是 `source_text` / `ocr_text`，蛇形命名的同义键直接绕过黑名单
 * 进了 payload。同理还有 `task_assignee` / `search_index` 这类业务字段。
 *
 * 因此判定顺序是：**先黑名单打码，再白名单放行，其余一律丢弃**。
 * 黑名单键保留 `[REDACTED]` 占位而不是丢掉，是为了在 ledger 里留下
 * 「有人试图把密钥塞进水印元数据」的痕迹；未知键则静默丢弃（fail-closed）。
 *
 * 结构键 + 已批准模板变量构成完整白名单：模板变量本就是水印可渲染的
 * 唯一一批用户可见字段，两者同源可避免各自漂移。
 */
export const WATERMARK_ALLOWED_METADATA_KEYS: readonly string[] = [
  'watermarkId',
  'watermarkHash',
  'payloadHash',
  'planHash',
  'decisionHash',
  'policyHash',
  'sourceHash',
  'organizationIdHash',
  'actorIdHash',
  'projectIdHash',
  'format',
  'mode',
  'renderedTextHash',
  'warningCodes',
  'createdAt',
  ...WATERMARK_APPROVED_TEMPLATE_VARIABLES,
] as const

/** 支持 native 水印的格式列表 */
export const WATERMARK_NATIVE_FORMATS: readonly WatermarkFormat[] = [
  'markdown',
  'csv',
  'html',
  'pdf',
] as const

/** 可降级处理的格式列表 */
export const WATERMARK_DEGRADABLE_FORMATS: readonly WatermarkFormat[] = ['unsupported'] as const

// ─── 接口 ──────────────────────────────────────────────────────────────────────────

/** 水印策略定义 */
export interface WatermarkPolicy {
  id: WatermarkPolicyId
  enabled: boolean
  mode: WatermarkMode
  organizationId: number
  scope: WatermarkPolicyScope
  template: string
  templateHash: string
  style: WatermarkStyle
  formatSupport: Partial<Record<WatermarkFormat, WatermarkFormatSupport>>
  blockUnsupported: boolean
  createdAt: string
  updatedAt: string
  updatedBy: number
  warningCodes: WatermarkWarningCode[]
}

/** 水印样式 */
export interface WatermarkStyle {
  opacity: number
  fontSize: number
  rotation: number
  repeat: boolean
  repeatCount: number
  position: WatermarkPosition
  color: string
  maxLength: number
}

/** 水印位置 */
export type WatermarkPosition =
  | 'header'
  | 'footer'
  | 'top_left'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_right'
  | 'center'
  | 'tile'

/** 水印格式支持级别 */
export interface WatermarkFormatSupport {
  level: WatermarkFormatSupportLevel
  strategy: string
  /** 可选：native 级别的格式本来就没有附带警告，强制写 `warningCode: null` 只是噪音。 */
  warningCode?: WatermarkWarningCode | null
}

/** 水印 DLP follow-up 需求 */
export interface WatermarkFollowUp {
  watermarkRequired: boolean
  policyId: WatermarkPolicyId | null
  mode: WatermarkMode | null
  format: WatermarkFormat
  templateHash: string | null
  warningCodes: WatermarkWarningCode[]
  /**
   * 本次导出/外发动作能否继续。
   *
   * **不能由 `watermarkRequired` 推导**：DLP block（不许外发）与「格式不支持但
   * 策略只警告」（可外发、只是没水印）都给出 `watermarkRequired: false`，
   * 但前者必须停、后者必须放行。少了这个字段，调用方只能靠 warningCodes
   * 反推，等价于把判定逻辑复制到每个 adapter 里。
   */
  canProceed: boolean
  /**
   * 是否需要用户二次确认后才落库/外发。
   * 对应 DLP 的 warn_confirm / mask_confirm 两档判定，与产品红线
   * 「AI 只建议、不自动执行」同源：需要确认的动作不得被适配器静默放行。
   */
  requiresConfirmation: boolean
}

/** 水印 plan（服务端生成） */
export interface WatermarkPlan {
  planId: string
  planHash: string
  actorId: number
  organizationId: number
  projectId: number | null
  action: string
  sourceRef: string
  sourceHash: string
  policyHash: string
  policyTemplateHash: string
  decisionHash: string
  format: WatermarkFormat
  mode: WatermarkMode
  template: string
  templateVariables: Partial<Record<string, string>>
  style: WatermarkStyle
  watermarkHash: string
  payloadHash: string
  warningCodes: WatermarkWarningCode[]
  requiresConfirmation: boolean
  expiresAt: string
  createdAt: string
}

/** 水印 payload（低敏，仅包含 hash 与枚举，不含原始内容） */
export interface WatermarkPayload {
  watermarkId: string
  watermarkHash: string
  payloadHash: string
  planHash: string
  decisionHash: string
  policyHash: string
  sourceHash: string
  organizationIdHash: string
  actorIdHash: string
  projectIdHash: string | null
  format: WatermarkFormat
  mode: WatermarkMode
  renderedTextHash: string
  warningCodes: WatermarkWarningCode[]
  createdAt: string
}

/**
 * 水印渲染记录（一次渲染的落库结果）。
 *
 * 注：原先这个接口与上方的状态联合 `WatermarkRenderResult` 同名，导致
 * 重复声明，且自身 `result` 字段变成自引用。状态联合被后端 model、
 * 常量表与类型守卫广泛引用，故保留联合名，接口改名为 Record。
 */
export interface WatermarkRenderRecord {
  planHash: string
  result: WatermarkRenderResult
  outputHash: string | null
  payload: WatermarkPayload | null
  warningCodes: WatermarkWarningCode[]
  renderedAt: string
}

/** 水印 ledger 事件 */
export interface WatermarkLedgerEvent {
  id: number
  organizationId: number
  projectId: number | null
  actorId: number
  eventType: WatermarkEventType
  format: WatermarkFormat | null
  mode: WatermarkMode | null
  result: WatermarkRenderResult | null
  planHash: string | null
  policyHash: string | null
  sourceHash: string | null
  decisionHash: string | null
  watermarkHash: string | null
  warningCodes: WatermarkWarningCode[]
  createdAt: string
}

/** 水印验证请求 */
export interface WatermarkVerificationRequest {
  watermarkHash: string
  sourceHash: string
  planHash: string
  organizationId: number
  actorId: number
}

/** 水印验证结果 */
export interface WatermarkVerificationResult {
  status: WatermarkVerificationStatus
  watermarkHash: string
  sourceHash: string
  planHash: string
  payloadHash: string | null
  decisionHash: string | null
  matchedAt: string | null
  reasonCodes: string[]
}

/** 水印策略摘要 */
export interface WatermarkPolicySummary {
  policyHash: string
  enabledPolicies: WatermarkPolicyId[]
  policyModes: Partial<Record<WatermarkPolicyId, WatermarkMode>>
  formatMatrix: Partial<Record<WatermarkFormat, WatermarkFormatSupport>>
  defaultTemplate: string
  templateHash: string
  warningCodes: WatermarkWarningCode[]
}

/** 水印预览请求 */
export interface WatermarkPreviewRequest {
  template: string
  templateVariables: Partial<Record<string, string>>
  style: WatermarkStyle
  format: WatermarkFormat
  mode: WatermarkMode
}

/** 水印预览结果 */
export interface WatermarkPreviewResult {
  previewHash: string
  renderedPreview: string
  variableWarnings: WatermarkWarningCode[]
  styleWarnings: WatermarkWarningCode[]
  expiresAt: string
}

/** 水印格式矩阵条目 */
export interface WatermarkFormatMatrixEntry {
  format: WatermarkFormat
  level: WatermarkFormatSupportLevel
  strategy: string
  visibleSupported: boolean
  metadataSupported: boolean
  warningCode: WatermarkWarningCode | null
}

// ─── 类型守卫 ──────────────────────────────────────────────────────────────────────

export function isWatermarkPolicyId(v: unknown): v is WatermarkPolicyId {
  return WATERMARK_POLICY_IDS.includes(v as WatermarkPolicyId)
}

export function isWatermarkRuleId(v: unknown): v is WatermarkRuleId {
  return WATERMARK_RULE_IDS.includes(v as WatermarkRuleId)
}

export function isWatermarkMode(v: unknown): v is WatermarkMode {
  return WATERMARK_MODES.includes(v as WatermarkMode)
}

export function isWatermarkFormat(v: unknown): v is WatermarkFormat {
  return WATERMARK_FORMATS.includes(v as WatermarkFormat)
}

export function isWatermarkFormatSupportLevel(v: unknown): v is WatermarkFormatSupportLevel {
  return WATERMARK_FORMAT_SUPPORT_LEVELS.includes(v as WatermarkFormatSupportLevel)
}

export function isWatermarkPolicyScope(v: unknown): v is WatermarkPolicyScope {
  return WATERMARK_POLICY_SCOPES.includes(v as WatermarkPolicyScope)
}

export function isWatermarkStatus(v: unknown): v is WatermarkStatus {
  return WATERMARK_STATUSES.includes(v as WatermarkStatus)
}

export function isWatermarkRenderResult(v: unknown): v is WatermarkRenderResult {
  return WATERMARK_RENDER_RESULTS.includes(v as WatermarkRenderResult)
}

export function isWatermarkEventType(v: unknown): v is WatermarkEventType {
  return WATERMARK_EVENT_TYPES.includes(v as WatermarkEventType)
}

export function isWatermarkWarningCode(v: unknown): v is WatermarkWarningCode {
  return WATERMARK_WARNING_CODES.includes(v as WatermarkWarningCode)
}

export function isWatermarkVerificationStatus(v: unknown): v is WatermarkVerificationStatus {
  return WATERMARK_VERIFICATION_STATUSES.includes(v as WatermarkVerificationStatus)
}

export function isWatermarkConfirmationStatus(v: unknown): v is WatermarkConfirmationStatus {
  return WATERMARK_CONFIRMATION_STATUSES.includes(v as WatermarkConfirmationStatus)
}

// ─── 纯函数 ────────────────────────────────────────────────────────────────────────

/**
 * 计算水印策略 hash。
 * 基于 enabledPolicies + policyModes + template + style + formatSupport 的稳定签名。
 */
export function computeWatermarkPolicyHash(params: {
  enabledPolicies: WatermarkPolicyId[]
  policyModes: Partial<Record<WatermarkPolicyId, WatermarkMode>>
  template: string
  style: WatermarkStyle
  formatSupport: Partial<Record<WatermarkFormat, WatermarkFormatSupport>>
  organizationId: number
}): string {
  return computeStableSignature({
    enabledPolicies: [...params.enabledPolicies].sort(),
    policyModes: Object.keys(params.policyModes)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = params.policyModes[key as WatermarkPolicyId]
        return acc
      }, {}),
    template: params.template,
    style: {
      opacity: params.style.opacity,
      fontSize: params.style.fontSize,
      rotation: params.style.rotation,
      repeat: params.style.repeat,
      repeatCount: params.style.repeatCount,
      position: params.style.position,
      color: params.style.color,
      maxLength: params.style.maxLength,
    },
    formatSupport: Object.keys(params.formatSupport)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const fs = params.formatSupport[key as WatermarkFormat]
        acc[key] = fs ? { level: fs.level, strategy: fs.strategy } : null
        return acc
      }, {}),
    organizationId: params.organizationId,
  })
}

/**
 * 计算模板 hash。
 * 基于模板内容的稳定 hash。
 */
export function computeWatermarkTemplateHash(template: string): string {
  return fnv1aHash(template)
}

/**
 * 计算水印 payload hash。
 * 基于 watermarkId + planHash + decisionHash + sourceHash 的稳定签名。
 */
export function computeWatermarkPayloadHash(params: {
  watermarkId: string
  planHash: string
  decisionHash: string
  sourceHash: string
}): string {
  return computeStableSignature({
    watermarkId: params.watermarkId,
    planHash: params.planHash,
    decisionHash: params.decisionHash,
    sourceHash: params.sourceHash,
  })
}

/**
 * 计算水印 plan hash。
 * 基于 actorId + organizationId + action + sourceHash + policyHash + format + mode 的稳定签名。
 */
export function computeWatermarkPlanHash(params: {
  actorId: number
  organizationId: number
  projectId: number | null
  action: string
  sourceHash: string
  policyHash: string
  /**
   * 必填：planHash 必须绑定**后端重算出的** DLP 决策。
   *
   * 缺了它，同一份源内容在 allow 与 mask 两种决策下会算出相同的 planHash，
   * 攻击者拿一个宽松决策下签发的 plan 去渲染严格决策的内容，服务端无从察觉。
   * 决策 hash 参与签名后，决策一变 planHash 就变，旧 plan 自然失效。
   */
  decisionHash: string
  format: WatermarkFormat
  mode: WatermarkMode
}): string {
  return computeStableSignature({
    actorId: params.actorId,
    organizationId: params.organizationId,
    projectId: params.projectId,
    action: params.action,
    sourceHash: params.sourceHash,
    policyHash: params.policyHash,
    decisionHash: params.decisionHash,
    format: params.format,
    mode: params.mode,
  })
}

/**
 * 计算水印 hash（渲染输出唯一标识）。
 * 基于 planHash + payloadHash + renderedTextHash 的稳定签名。
 */
export function computeWatermarkHash(params: {
  planHash: string
  payloadHash: string
  renderedTextHash: string
}): string {
  return computeStableSignature({
    planHash: params.planHash,
    payloadHash: params.payloadHash,
    renderedTextHash: params.renderedTextHash,
  })
}

/**
 * 计算渲染文本 hash。
 */
export function computeRenderedTextHash(text: string): string {
  return fnv1aHash(text)
}

/**
 * 计算预览 hash。
 * 基于 template + templateVariables + style + format + mode 的稳定签名。
 */
export function computeWatermarkPreviewHash(params: {
  template: string
  templateVariables: Partial<Record<string, string>>
  style: WatermarkStyle
  format: WatermarkFormat
  mode: WatermarkMode
}): string {
  return computeStableSignature({
    template: params.template,
    templateVariables: Object.keys(params.templateVariables)
      .sort()
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = params.templateVariables[key] ?? ''
        return acc
      }, {}),
    style: {
      opacity: params.style.opacity,
      fontSize: params.style.fontSize,
      rotation: params.style.rotation,
      repeat: params.style.repeat,
      repeatCount: params.style.repeatCount,
      position: params.style.position,
      color: params.style.color,
      maxLength: params.style.maxLength,
    },
    format: params.format,
    mode: params.mode,
  })
}

/**
 * 校验模板变量是否在已批准白名单中。
 * 返回未批准的变量名列表，空数组表示全部通过。
 */
export function validateWatermarkTemplateVariables(
  variables: Partial<Record<string, string>>,
): string[] {
  const approvedSet = new Set(WATERMARK_APPROVED_TEMPLATE_VARIABLES)
  const rejected: string[] = []
  for (const key of Object.keys(variables)) {
    if (!approvedSet.has(key)) {
      rejected.push(key)
    }
  }
  return rejected
}

/**
 * 检查水印不透明度是否在有效范围内。
 */
export function isOpacityInRange(opacity: number): boolean {
  return opacity >= WATERMARK_OPACITY_MIN && opacity <= WATERMARK_OPACITY_MAX
}

/**
 * 检查水印字体大小是否在有效范围内。
 */
export function isFontSizeInRange(fontSize: number): boolean {
  return fontSize >= WATERMARK_FONT_SIZE_MIN && fontSize <= WATERMARK_FONT_SIZE_MAX
}

/**
 * 检查水印旋转角度是否在有效范围内。
 */
export function isRotationInRange(rotation: number): boolean {
  return rotation >= WATERMARK_ROTATION_MIN && rotation <= WATERMARK_ROTATION_MAX
}

/**
 * 检查重复次数是否在有效范围内。
 */
export function isRepeatCountInRange(repeatCount: number): boolean {
  return repeatCount >= 1 && repeatCount <= WATERMARK_MAX_REPEAT_COUNT
}

/**
 * 检查渲染文本长度是否在有效范围内。
 */
export function isRenderedTextLengthInRange(length: number): boolean {
  return length >= 1 && length <= WATERMARK_MAX_TEXT_LENGTH
}

/**
 * 校验水印样式边界。
 * 返回 warning code 列表，空数组表示全部通过。
 */
export function validateWatermarkStyleBounds(style: WatermarkStyle): WatermarkWarningCode[] {
  const warnings: WatermarkWarningCode[] = []
  if (!isOpacityInRange(style.opacity)) {
    warnings.push('WM_STYLE_BOUND_EXCEEDED')
  }
  if (!isFontSizeInRange(style.fontSize)) {
    warnings.push('WM_STYLE_BOUND_EXCEEDED')
  }
  if (!isRotationInRange(style.rotation)) {
    warnings.push('WM_STYLE_BOUND_EXCEEDED')
  }
  if (!isRepeatCountInRange(style.repeatCount)) {
    warnings.push('WM_STYLE_BOUND_EXCEEDED')
  }
  if (!isRenderedTextLengthInRange(style.maxLength)) {
    warnings.push('WM_STYLE_BOUND_EXCEEDED')
  }
  return warnings
}

/**
 * 校验格式支持级别是否为 native 或 degraded（可用于水印渲染）。
 */
export function isFormatRenderable(level: WatermarkFormatSupportLevel): boolean {
  return level === 'native' || level === 'degraded'
}

/**
 * 根据 DLP 决策结果确定水印 follow-up 需求。
 * 当 DLP 结果为 block 时，水印不得降级为可下载。
 * 当 DLP 结果为 mask、warn_confirm、mask_confirm 时，可选择性添加水印。
 * 当 DLP 结果为 allow、audit_only 时，可根据策略配置是否添加水印。
 */
export function resolveWatermarkFollowUp(params: {
  dlpResult: string
  format: WatermarkFormat
  formatSupport: Partial<Record<WatermarkFormat, WatermarkFormatSupport>>
  policyEnabled: boolean
  blockUnsupported: boolean
}): WatermarkFollowUp {
  // 需要二次确认的两档 DLP 判定。即使最终不打水印（策略停用 / 格式不支持但只警告），
  // 确认要求也不能被抹掉——它来自 DLP 决策本身，不是水印的附属品。
  const requiresConfirmation =
    params.dlpResult === 'warn_confirm' || params.dlpResult === 'mask_confirm'

  // DLP block 时，水印必须跟随阻断
  if (params.dlpResult === 'block') {
    return {
      watermarkRequired: false,
      policyId: null,
      mode: null,
      format: params.format,
      templateHash: null,
      warningCodes: ['WM_DLP_BLOCKED'],
      canProceed: false,
      requiresConfirmation: false,
    }
  }

  // 策略未启用 → 不生成水印。能否继续仍看 blockUnsupported：
  // 该开关表达的是组织「拿不到水印就不许外发」的立场，策略被停用同样属于
  // 「拿不到水印」，在这里放行等于给了一条绕过水印要求的旁路。
  if (!params.policyEnabled) {
    return {
      watermarkRequired: false,
      policyId: null,
      mode: null,
      format: params.format,
      templateHash: null,
      warningCodes: [],
      canProceed: !params.blockUnsupported,
      requiresConfirmation: params.blockUnsupported ? false : requiresConfirmation,
    }
  }

  const support = params.formatSupport[params.format]

  // 不支持的格式（含 formatSupport 中根本没有登记该格式的情况）：
  // blockUnsupported 决定这是「拦停」还是「降级放行」。
  if (!support || support.level === 'unsupported') {
    return {
      watermarkRequired: false,
      policyId: null,
      mode: null,
      format: params.format,
      templateHash: null,
      warningCodes: [
        params.blockUnsupported ? 'WM_FORMAT_UNSUPPORTED' : 'WM_FORMAT_UNSUPPORTED_WARN',
      ],
      canProceed: !params.blockUnsupported,
      requiresConfirmation: params.blockUnsupported ? false : requiresConfirmation,
    }
  }

  const warnings: WatermarkWarningCode[] = []
  if (support.warningCode) {
    warnings.push(support.warningCode)
  }

  return {
    watermarkRequired: true,
    policyId: 'watermark_visible',
    mode: 'visible',
    format: params.format,
    templateHash: null,
    warningCodes: warnings,
    canProceed: true,
    requiresConfirmation,
  }
}

/**
 * 构建水印格式矩阵条目。
 */
export function buildFormatMatrixEntry(params: {
  format: WatermarkFormat
  level: WatermarkFormatSupportLevel
  strategy: string
  visibleSupported: boolean
  metadataSupported: boolean
  warningCode: WatermarkWarningCode | null
}): WatermarkFormatMatrixEntry {
  return {
    format: params.format,
    level: params.level,
    strategy: params.strategy,
    visibleSupported: params.visibleSupported,
    metadataSupported: params.metadataSupported,
    warningCode: params.warningCode,
  }
}

/**
 * 构建水印格式矩阵（返回所有格式的支持信息）。
 */
export function buildFormatMatrix(
  overrides?: Partial<Record<WatermarkFormat, WatermarkFormatSupport>>,
): WatermarkFormatMatrixEntry[] {
  const defaultMatrix: Record<WatermarkFormat, WatermarkFormatMatrixEntry> = {
    markdown: {
      format: 'markdown',
      level: 'native',
      strategy: 'header_footer_block',
      visibleSupported: true,
      metadataSupported: true,
      warningCode: null,
    },
    csv: {
      format: 'csv',
      level: 'native',
      strategy: 'comment_row_or_footer',
      visibleSupported: true,
      metadataSupported: false,
      warningCode: null,
    },
    html: {
      format: 'html',
      level: 'native',
      strategy: 'header_footer_meta_tags',
      visibleSupported: true,
      metadataSupported: true,
      warningCode: null,
    },
    pdf: {
      format: 'pdf',
      level: 'native',
      strategy: 'pdf_overlay',
      visibleSupported: true,
      metadataSupported: true,
      warningCode: null,
    },
    unsupported: {
      format: 'unsupported',
      level: 'unsupported',
      strategy: 'block_or_warn',
      visibleSupported: false,
      metadataSupported: false,
      warningCode: 'WM_FORMAT_UNSUPPORTED',
    },
  }

  if (overrides) {
    for (const [format, support] of Object.entries(overrides)) {
      const f = format as WatermarkFormat
      if (support && defaultMatrix[f]) {
        defaultMatrix[f] = {
          ...defaultMatrix[f],
          level: support.level,
          strategy: support.strategy,
          visibleSupported: support.level !== 'unsupported',
          metadataSupported: support.level === 'native',
          warningCode: support.warningCode ?? null,
        }
      }
    }
  }

  return WATERMARK_FORMATS.map((f) => defaultMatrix[f])
}

/**
 * 构建低敏水印 payload。
 * 只包含 hash 与枚举，不包含原始内容。
 */
export function buildWatermarkPayload(params: {
  watermarkId: string
  watermarkHash: string
  payloadHash: string
  planHash: string
  decisionHash: string
  policyHash: string
  sourceHash: string
  organizationId: number
  actorId: number
  projectId: number | null
  format: WatermarkFormat
  mode: WatermarkMode
  renderedTextHash: string
  warningCodes: WatermarkWarningCode[]
}): WatermarkPayload {
  return {
    watermarkId: params.watermarkId,
    watermarkHash: params.watermarkHash,
    payloadHash: params.payloadHash,
    planHash: params.planHash,
    decisionHash: params.decisionHash,
    policyHash: params.policyHash,
    sourceHash: params.sourceHash,
    organizationIdHash: fnv1aHash(String(params.organizationId)),
    actorIdHash: fnv1aHash(String(params.actorId)),
    projectIdHash: params.projectId !== null ? fnv1aHash(String(params.projectId)) : null,
    format: params.format,
    mode: params.mode,
    renderedTextHash: params.renderedTextHash,
    warningCodes: params.warningCodes,
    createdAt: new Date().toISOString(),
  }
}

/**
 * 构建水印 ledger 事件（低敏，只包含 hash/枚举/计数，不含原始内容）。
 */
export function buildWatermarkLedgerEvent(params: {
  organizationId: number
  projectId: number | null
  actorId: number
  eventType: WatermarkEventType
  format: WatermarkFormat | null
  mode: WatermarkMode | null
  result: WatermarkRenderResult | null
  planHash: string | null
  policyHash: string | null
  sourceHash: string | null
  decisionHash: string | null
  watermarkHash: string | null
  warningCodes: WatermarkWarningCode[]
}): WatermarkLedgerEvent {
  return {
    id: 0,
    organizationId: params.organizationId,
    projectId: params.projectId,
    actorId: params.actorId,
    eventType: params.eventType,
    format: params.format,
    mode: params.mode,
    result: params.result,
    planHash: params.planHash,
    policyHash: params.policyHash,
    sourceHash: params.sourceHash,
    decisionHash: params.decisionHash,
    watermarkHash: params.watermarkHash,
    warningCodes: params.warningCodes,
    createdAt: new Date().toISOString(),
  }
}

/**
 * 脱敏水印审计元数据（fail closed）。
 * 去除所有禁止键的值，替换为 '[REDACTED]'。
 */
export function redactWatermarkMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  const forbiddenSet = new Set(WATERMARK_FORBIDDEN_KEYS.map((k) => k.toLowerCase()))
  const allowedSet = new Set(WATERMARK_ALLOWED_METADATA_KEYS.map((k) => k.toLowerCase()))
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = key.toLowerCase()
    // 黑名单优先于白名单：万一某个键同时出现在两张表里，也必须打码。
    if (forbiddenSet.has(normalized)) {
      redacted[key] = '[REDACTED]'
    } else if (allowedSet.has(normalized)) {
      redacted[key] = value
    }
    // 既不在黑名单也不在白名单 → 丢弃，不写入 redacted。
  }
  return redacted
}

/**
 * 判断水印计划是否过期。
 */
export function isWatermarkPlanExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now()
}

/**
 * 根据 warning code 排序并去重。
 */
export function sortWatermarkWarnings(warnings: WatermarkWarningCode[]): WatermarkWarningCode[] {
  return [...new Set(warnings)].sort()
}

/**
 * 构建默认水印样式。
 */
export function buildDefaultWatermarkStyle(overrides?: Partial<WatermarkStyle>): WatermarkStyle {
  return {
    opacity: 0.3,
    fontSize: 12,
    rotation: 0,
    repeat: false,
    repeatCount: 1,
    position: 'footer',
    color: '#999999',
    maxLength: 200,
    ...overrides,
  }
}

/**
 * 构建默认水印策略摘要。
 */
export function buildDefaultWatermarkPolicySummary(
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

/**
 * 根据格式获取支持级别。
 */
export function getFormatSupportLevel(
  format: WatermarkFormat,
  formatMatrix: Partial<Record<WatermarkFormat, WatermarkFormatSupport>>,
): WatermarkFormatSupportLevel {
  const support = formatMatrix[format]
  if (!support) return 'unsupported'
  return support.level
}
