/**
 * v3-copilot-external-content-safety — CopilotExternalContentInjectionDetector（§4）。
 *
 * 外部内容注入检测器：确定性规则优先（D2），模型辅助可选且默认关闭。
 * 检测四类注入：指令覆盖、角色扮演、工具诱导、编码绕过。
 * 规则命中即拦截，模型结论不得推翻规则拦截（§4.5）。
 * 检测确定性：同一内容同一规则集产出同一结论（§4.6）。
 *
 * 设计要点：
 * - 纯函数 + 无状态：输入内容 → 输出检测结论
 * - 不依赖网络、模型、数据库或外部服务
 * - 检测记录不含命中原文（D6 禁存约束）
 *
 * @aiproj/backend
 */
import type {
  ExternalContentEntry,
  ExternalDetectionRecord,
  ExternalInjectionCategory,
  ExternalDetectionVerdict,
} from '@aiproj/types'
import { EXTERNAL_DETECTOR_VERSION } from '@aiproj/types'

// ---------------------------------------------------------------------------
// 确定性规则集（§4.1 / D2）
// ---------------------------------------------------------------------------

/**
 * 注入检测规则：按类别组织的正则模式列表。
 * 每个类别至少一个规则，规则命中即标记该类别。
 *
 * 规则来源：自建最小集合（design.md Open Question 1），
 * 不引入外部规则库以免带来供应链依赖。
 */
const INJECTION_RULES: Readonly<Record<ExternalInjectionCategory, readonly RegExp[]>> = {
  instruction_override: [
    /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|guidelines?|directives?)/i,
    /disregard\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?)/i,
    /forget\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|context)/i,
    /override\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?)/i,
    /new\s+instructions?\s*[:：]\s*/i,
    /system\s*[:：]\s*(you\s+are|act\s+as|forget|ignore)/i,
    /(?:^|\n)\s*(?:human|user)\s*[:：]/i,
    /\[INST\]/i,
    /<\|im_start\|>/i,
  ],
  role_play: [
    /you\s+are\s+now\s+(?:a|an|the)\s+/i,
    /act\s+as\s+(?:a|an|the)\s+/i,
    /pretend\s+(?:you\s+are|to\s+be)\s+(?:a|an|the)\s+/i,
    /roleplay\s+as\s+(?:a|an|the)\s+/i,
    /from\s+now\s+on\s*,?\s*you\s+(?:will|shall|must|are)\s+/i,
    /(?:enter|switch\s+to)\s+(?:developer|debug|admin|root|god)\s+mode/i,
    /you\s+(?:are|have\s+been)\s+(?:promoted|elevated|upgraded)\s+to/i,
  ],
  tool_inducement: [
    /(?:please\s+)?(?:call|invoke|execute|run|use)\s+(?:the\s+)?(?:tool|function|api|command|script)/i,
    /(?:send|emit|trigger|dispatch)\s+(?:a\s+)?(?:tool|function|api)\s*(?:call|request|invocation)/i,
    /(?:make|perform)\s+(?:a\s+)?(?:tool|function|api|http)\s*(?:call|request)/i,
    /(?:write|create|modify|delete|update)\s+(?:the\s+)?(?:file|database|table|record|entry)/i,
    /(?:export|send|upload|transmit)\s+(?:all|every|the\s+entire)\s+/i,
    /(?:curl|wget|fetch)\s+(?:http|https):\/\//i,
  ],
  encoding_evasion: [
    /(?:base64|hex|rot13|url)\s*(?:encode|decode|enc|dec)/i,
    /(?:\\x[0-9a-f]{2}){4,}/i,
    /(?:&#(?:x[0-9a-f]+|\d+);){3,}/i,
    /[\u200b\u200c\u200d\ufeff]{3,}/,
    /(?:nbsp|zwnj|zwj)\s*(?:character|entity|code)/i,
  ],
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 检测单个外部内容条目的注入（§4.1 / D2）。
 * 返回命中的类别列表和各类别命中计数。
 *
 * 确定性保证（§4.6）：纯函数 + 正则匹配，无随机性，同一输入同一输出。
 */
function detectInjectionInContent(entry: ExternalContentEntry): {
  hitCategories: ExternalInjectionCategory[]
  hitCounts: Record<ExternalInjectionCategory, number>
  totalHits: number
} {
  // 使用 entry 的 lowSensitivitySummary 作为检测输入
  // （正文不落记录，但检测需要基于内容；这里用摘要+URL 作为检测面）
  const contentToScan = `${entry.url} ${entry.lowSensitivitySummary}`

  const hitCategories: ExternalInjectionCategory[] = []
  const hitCounts: Record<ExternalInjectionCategory, number> = {
    instruction_override: 0,
    role_play: 0,
    tool_inducement: 0,
    encoding_evasion: 0,
  }
  let totalHits = 0

  for (const [category, rules] of Object.entries(INJECTION_RULES) as [
    ExternalInjectionCategory,
    readonly RegExp[],
  ][]) {
    for (const rule of rules) {
      if (rule.test(contentToScan)) {
        hitCounts[category]++
        totalHits++
      }
    }
    if (hitCounts[category] > 0) {
      hitCategories.push(category)
    }
  }

  return { hitCategories, hitCounts, totalHits }
}

/** 文本是否命中任一注入规则。 */
function hitsInjectionRule(text: string): boolean {
  for (const rules of Object.values(INJECTION_RULES)) {
    for (const rule of rules) {
      if (rule.test(text)) return true
    }
  }
  return false
}

/**
 * 句级剔除：把命中注入规则的句子整句删掉，其余原样保留（保持原文顺序）。
 *
 * 用途：网页摘要里常夹着一句「use the API…」「update the record…」这类页面文案，
 * 整条结果因此被丢弃会让网页搜索几乎永远「未通过安全检查」。剔除后的文本须再次整体
 * 检测通过才可使用——命中的原句永不进入模型上下文，规则拦截语义不变（§4.3）。
 * 确定性：纯函数，同一输入同一输出。
 */
export function redactInjectedSentences(text: string): string {
  if (!hitsInjectionRule(text)) return text
  return text
    .split(/(?<=[。！？!?；;])|\n|(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '' && !hitsInjectionRule(sentence))
    .join(' ')
    .trim()
}

// ---------------------------------------------------------------------------
// CopilotExternalContentInjectionDetector 服务
// ---------------------------------------------------------------------------

export class CopilotExternalContentInjectionDetector {
  /**
   * §4.1: 检测外部内容条目的注入（确定性规则优先）。
   *
   * 返回检测记录和判定结果。
   * - 规则命中 → verdict = 'rejected'（§4.3）
   * - 规则未命中 → verdict = 'passed'
   * - 检测不可用（内容无法解析等） → verdict = 'unavailable'（§7.1）
   */
  detectEntry(
    entry: ExternalContentEntry,
    organizationId: number,
  ): {
    verdict: ExternalDetectionVerdict
    record?: ExternalDetectionRecord
  } {
    // 如果条目已标记为不可用（如上游检测服务失败），直接返回不可用
    if (entry.detectionVerdict === 'unavailable') {
      return { verdict: 'unavailable' }
    }

    // 检测不可用防御：如果 entry 缺少必要字段，视为不可用
    if (!entry.lowSensitivitySummary && !entry.url) {
      return { verdict: 'unavailable' }
    }

    const { hitCategories, hitCounts, totalHits } = detectInjectionInContent(entry)

    if (totalHits > 0) {
      // §4.3: 规则命中即拦截
      const record: ExternalDetectionRecord = {
        recordId: `det-${entry.entryId}-${Date.now()}`,
        hitCategories,
        hitCounts,
        totalHits,
        detectorVersion: EXTERNAL_DETECTOR_VERSION,
        detectedAt: new Date().toISOString(),
        organizationId,
      }
      return { verdict: 'rejected', record }
    }

    // 规则未命中 → passed
    return { verdict: 'passed' }
  }

  /**
   * §4.2: 批量检测多个外部内容条目。
   */
  detectBatch(
    entries: readonly ExternalContentEntry[],
    organizationId: number,
  ): {
    results: Array<{
      entry: ExternalContentEntry
      verdict: ExternalDetectionVerdict
      record?: ExternalDetectionRecord
    }>
    totalRejected: number
    totalPassed: number
    totalUnavailable: number
  } {
    let totalRejected = 0
    let totalPassed = 0
    let totalUnavailable = 0

    const results = entries.map((entry) => {
      const { verdict, record } = this.detectEntry(entry, organizationId)
      if (verdict === 'rejected') totalRejected++
      else if (verdict === 'passed') totalPassed++
      else totalUnavailable++
      return { entry, verdict, record }
    })

    return { results, totalRejected, totalPassed, totalUnavailable }
  }

  /**
   * §4.5: 模型辅助检测为可选且默认关闭。
   * 即使模型结论与规则冲突，规则拦截不可被推翻。
   *
   * 本方法为模型辅助检测的接入点（当前默认关闭）。
   * 将来若开启，模型只在规则未命中时提供额外信号，
   * 且其结论不能推翻规则的放行判断为拦截以外的方向。
   */
  applyModelAssistOverride(
    ruleVerdict: ExternalDetectionVerdict,
    _modelVerdict: ExternalDetectionVerdict,
  ): ExternalDetectionVerdict {
    // §4.5: 模型结论不得推翻规则的拦截判定
    // 如果规则已拦截，无论模型说什么都保持拦截
    if (ruleVerdict === 'rejected') {
      return 'rejected'
    }
    // 如果规则放行，模型可以在将来提供额外信号
    // 当前实现：模型辅助默认关闭，直接返回规则判定
    return ruleVerdict
  }
}
