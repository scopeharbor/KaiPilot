/**
 * v3-triz-to-delivery-closed-loop —— advisory contribution 宿主与 AI draft 服务
 * （tasks 8.1–8.6，P1）。
 *
 * Advisory contract（D7）：
 * - 版本化、大小受限的四类贡献：delivery_template / acceptance_metric_suggestion /
 *   effectiveness_rubric / retrospective_draft；全部强制 `advisory=true` + provenance。
 * - 宿主 validator：未知 capability、超大小、缺 provenance、forbidden keys、
 *   direct write 意图（任何 link/verify/reopen/posture 字样动词性命令键）一律拒绝。
 * - 插件停用/卸载/超时/坏载荷只降级本区，核心 posture/link/verification 不受影响。
 *
 * AI draft service：
 * - 仅显式触发；默认确定性 fallback（providerCalls=0, networkCalls=0）；
 *   未授权不接 AIGateway，预算/凭证不存在时恒走 fallback 并标注。
 * - 输出永不写 link/event、不推进 posture、不改正式数据、不触发 reopen。
 */
import type { TrizDlDegradedReason, TrizDlVerificationConclusion } from '@aiproj/types'
import { scanTrizDlForbiddenKeys, sanitizeTrizDlText } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 8.1 版本化 bounded advisory contribution 契约
// ---------------------------------------------------------------------------

export const TRIZ_DL_ADVISORY_CAPABILITIES = [
  'delivery_template',
  'acceptance_metric_suggestion',
  'effectiveness_rubric',
  'retrospective_draft',
] as const
export type TrizDlAdvisoryCapability = (typeof TRIZ_DL_ADVISORY_CAPABILITIES)[number]

export interface TrizDlAdvisoryContribution {
  /** advisory 标记是硬校验字段：缺失或非 true 即拒绝。 */
  advisory: true
  capability: TrizDlAdvisoryCapability
  version: string
  source: { pluginId: string; provider: string }
  content: string
}

export interface TrizDlAdvisoryBlock {
  capability: TrizDlAdvisoryCapability
  content: string
  provenance: string
  version: string
  advisory: true
}

export interface TrizDlAdvisoryResult {
  available: boolean
  degradedReasons: TrizDlDegradedReason[]
  blocks: TrizDlAdvisoryBlock[]
}

export const TRIZ_DL_ADVISORY_MAX_CONTENT_CHARS = 2000
const KNOWN_VERB_KEYS = new Set([
  'link',
  'confirm',
  'verify',
  'reopen',
  'apply',
  'approve',
  'write',
  'posture',
  'status_transition',
])

/** 单插件贡献解析：返回 block 或 degrade 原因（绝不抛出——局部隔离）。 */
export function resolveAdvisoryContribution(
  raw: unknown,
): { block: TrizDlAdvisoryBlock } | { reason: TrizDlDegradedReason } {
  if (raw === null || typeof raw !== 'object') return { reason: 'invalid_output' }
  const obj = raw as Record<string, unknown>

  const capability = obj['capability']
  if (
    typeof capability !== 'string' ||
    !(TRIZ_DL_ADVISORY_CAPABILITIES as readonly string[]).includes(capability)
  ) {
    return { reason: 'invalid_output' }
  }
  if (obj['advisory'] !== true) return { reason: 'forbidden_content' }

  // direct-write 意图检测：载荷顶层出现命令性动词键即拒绝
  for (const key of Object.keys(obj)) {
    if (KNOWN_VERB_KEYS.has(key.toLowerCase())) return { reason: 'forbidden_content' }
  }
  if (scanTrizDlForbiddenKeys(obj).length > 0) return { reason: 'forbidden_content' }

  const source = obj['source']
  if (!source || typeof source !== 'object') return { reason: 'invalid_output' }
  const pluginId = (source as Record<string, unknown>)['pluginId']
  const provider = (source as Record<string, unknown>)['provider']
  if (typeof pluginId !== 'string' || typeof provider !== 'string') {
    return { reason: 'invalid_output' }
  }

  const version = typeof obj['version'] === 'string' ? obj['version'] : ''
  if (!/^[\w.-]{1,32}$/.test(version)) return { reason: 'invalid_output' }

  const content = sanitizeTrizDlText(
    typeof obj['content'] === 'string' ? obj['content'] : null,
    TRIZ_DL_ADVISORY_MAX_CONTENT_CHARS,
  )
  if (!content) return { reason: 'invalid_output' }

  return {
    block: {
      capability: capability as TrizDlAdvisoryCapability,
      content,
      provenance: `${pluginId}@${provider}`,
      version,
      advisory: true,
    },
  }
}

/**
 * 8.2–8.4 宿主装配器：注入「当前已启用插件的贡献原语」，
 * 逐项隔离失败；宿主自身零数据库写入能力。
 */
export function assembleTrizDlAdvisories(
  contributions: readonly unknown[],
  opts: { pluginEnabled: boolean; timeout: boolean; oversize: boolean },
): TrizDlAdvisoryResult {
  if (!opts.pluginEnabled) {
    return { available: false, degradedReasons: ['plugin_disabled'], blocks: [] }
  }
  const degradedReasons: TrizDlDegradedReason[] = []
  if (opts.timeout) degradedReasons.push('plugin_timeout')
  if (opts.oversize) degradedReasons.push('payload_oversize')

  const blocks: TrizDlAdvisoryBlock[] = []
  for (const raw of contributions) {
    const r = resolveAdvisoryContribution(raw)
    if ('block' in r) blocks.push(r.block)
    else degradedReasons.push(r.reason)
  }
  return {
    available: blocks.length > 0,
    degradedReasons: degradedReasons.length > 0 ? dedupe(degradedReasons) : [],
    blocks,
  }
}

function dedupe(list: TrizDlDegradedReason[]): TrizDlDegradedReason[] {
  return [...new Set(list)]
}

// ---------------------------------------------------------------------------
// 8.5/8.6 AI draft service（draft-only；默认确定性 fallback）
// ---------------------------------------------------------------------------

export interface TrizDlAiDraftRequestContext {
  decisionLogId: string
  posture: string
  conclusion: TrizDlVerificationConclusion | null
  visibleDeliveryCount: number
}

export interface TrizDlAiDraftResult {
  draftType: 'delivery_breakdown' | 'metrics_draft' | 'retrospective'
  content: string
  isFallback: boolean
  advisory: true
  costSummary: { providerCalls: 0; networkCalls: 0; model: null }
  degradedReasons: TrizDlDegradedReason[]
}

/**
 * 显式触发的草稿生成。未获授权真实验证时恒走确定性 fallback；
 * 输入中的 verdict 只允许三结论闭集词面回显，不做任何推断。
 */
export class TrizDlAiDraftService {
  generateDraft(
    draftType: 'delivery_breakdown' | 'metrics_draft' | 'retrospective',
    ctx: TrizDlAiDraftRequestContext,
    aiAuthorized: boolean,
  ): TrizDlAiDraftResult {
    void aiAuthorized // 真实模型 smoke 未授权：一律不走网关（授权门）
    const lines: string[] = []
    const verdict =
      ctx.conclusion === null ? '尚未记录人工验证结论' : `人工验证结论为「${ctx.conclusion}」`
    switch (draftType) {
      case 'delivery_breakdown':
        lines.push(`【交付拆解建议】决策 ${ctx.decisionLogId}`)
        lines.push(`当前可见交付实体 ${ctx.visibleDeliveryCount} 个（不含不可见项）。`)
        lines.push('请通过 Draft Layer Preview 为新增工作创建候选，再经人工确认落库。')
        break
      case 'metrics_draft':
        lines.push('【验收指标建议】')
        lines.push(`- 与 ${verdict} 相关联的可观察指标应由人工定义基线/目标口径。`)
        lines.push('- 指标草案不改变任务状态，亦不计入效果判定。')
        break
      case 'retrospective':
        lines.push('【复盘摘要草稿】')
        lines.push(`当前姿态 ${ctx.posture}；${verdict}。`)
        lines.push('有效/无效判断须由人工在完整证据下做出，AI 草稿仅供参考。')
        break
    }
    return {
      draftType,
      content: sanitizeTrizDlText(lines.join('\n'), TRIZ_DL_ADVISORY_MAX_CONTENT_CHARS)!,
      isFallback: true,
      advisory: true,
      costSummary: { providerCalls: 0, networkCalls: 0, model: null },
      degradedReasons: ['ai_unavailable'],
    }
  }
}
