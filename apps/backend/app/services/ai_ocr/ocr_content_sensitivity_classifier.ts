/**
 * OcrContentSensitivityClassifier — OCR 内容敏感度分类器（v3-ocr-privacy-policy-controls §4.4）
 *
 * 职责：
 * - 将 OCR 相关记录按敏感度归类
 * - 区分 source metadata、candidate text、accepted text、structured values、
 *   entity spans、search snippets、provider summaries、audit/tombstone data
 * - 防止 full OCR text / raw provider bodies / prompts / secrets / 绝对路径被误归类为低敏感
 * - 提供低敏感脱敏辅助方法
 */
import {
  type OcrContentSensitivityCategory,
  type OcrPrivacyRedactionContext,
  isHighSensitivityCategory,
  buildPrivacyRedactionSummary,
} from '@aiproj/types'

/** 默认分类映射 */
const DEFAULT_CATEGORY_MAP: Record<string, OcrContentSensitivityCategory> = {
  source_metadata: 'source_metadata',
  source_preview: 'source_preview',
  job: 'job_metadata',
  job_metadata: 'job_metadata',
  page: 'candidate_metadata',
  page_state: 'candidate_metadata',
  candidate_text: 'candidate_text',
  candidate_metadata: 'candidate_metadata',
  accepted_extraction_text: 'accepted_extraction_text',
  accepted_extraction_metadata: 'accepted_extraction_metadata',
  structured_values: 'structured_values',
  entity_link_spans: 'entity_link_spans',
  search_snippets: 'search_snippets',
  provider_summaries: 'provider_summaries',
  provider_observability: 'provider_summaries',
  audit_metadata: 'audit_metadata',
  audit: 'audit_metadata',
  tombstone: 'tombstone_data',
  tombstone_data: 'tombstone_data',
}

/** 绝对禁止被归类为低敏感的标记——入站内容如果匹配这些模式，自动升级为高敏感 */
const DANGEROUS_PATTERNS = [
  /^Bearer\s+/i, // Authorization headers
  /^sk-[a-zA-Z0-9]+/, // API keys (OpenAI-like)
  /^[a-z]+:\/\/\//, // 文件 URL
  /^([A-Z]:\\|\\\\)/, // Windows 绝对路径
  /^\/(home|etc|opt|var)\//, // Unix 绝对路径
  /^\{[\s\S]*"model_output/.test.bind(/^\{[\s\S]*"model_output/), // Raw provider bodies
]

/** 分类单个内容为敏感度类别 */
export function classifyOcrContent(
  kind: string,
  text?: string | null,
): OcrContentSensitivityCategory {
  // 检测危险输入
  if (text && isDangerousInput(text)) {
    // 如果入站内容包含危险标记，强制升级
    const baseCategory = DEFAULT_CATEGORY_MAP[kind] ?? 'accepted_extraction_text'
    if (!isHighSensitivityCategory(baseCategory)) {
      return 'accepted_extraction_text' // 升级为高敏感
    }
    return baseCategory
  }

  return DEFAULT_CATEGORY_MAP[kind] ?? 'accepted_extraction_text'
}

/** 分类多个记录 */
export function classifyOcrContentBatch(
  items: Array<{ kind: string; text?: string | null }>,
): OcrContentSensitivityCategory[] {
  return items.map((item) => classifyOcrContent(item.kind, item.text))
}

/** 检测危险内容 */
function isDangerousInput(text: string): boolean {
  if (!text || text.length === 0) return false

  // 截取前 256 字符检测（避免扫描整段 OCR 文本）
  const header = text.slice(0, 256)

  return DANGEROUS_PATTERNS.some((pattern) => {
    if (typeof pattern === 'function') return pattern(header)
    return pattern.test(header)
  })
}

/** 生成低敏感脱敏上下文 */
export function buildRedactionContext(params: {
  category: OcrContentSensitivityCategory
  isSourceVisible: boolean
  isLifecycleValid: boolean
}): OcrPrivacyRedactionContext {
  if (!params.isSourceVisible) {
    return {
      type: 'hidden',
      reason: 'source_hidden',
      allowedFields: ['sourceKind', 'sourceHash', 'extractionId', 'lifecycleState'],
    }
  }

  if (!params.isLifecycleValid) {
    return {
      type: 'blocked',
      reason: 'lifecycle_expired',
      allowedFields: [],
    }
  }

  if (isHighSensitivityCategory(params.category)) {
    return {
      type: 'masked',
      reason: 'category_blocked',
      allowedFields: ['sourceKind', 'sourceHash', 'extractionId', 'lifecycleState', 'contentHash'],
    }
  }

  return {
    type: 'metadata_only',
    reason: 'category_blocked',
    allowedFields: [
      'sourceKind',
      'sourceHash',
      'extractionId',
      'lifecycleState',
      'createdAt',
      'contentHash',
    ],
  }
}

/** 脱敏总结——生成不包含完整 OCR 文本的摘要 */
export function summarizeClassification(
  category: OcrContentSensitivityCategory,
  _kind: string,
): string {
  return buildPrivacyRedactionSummary({
    category,
    action: 'read',
    reason: isHighSensitivityCategory(category) ? 'category_blocked' : 'category_blocked',
  })
}
