/**
 * v3-copilot-structured-and-diagram-output —— 图表守卫桥接层。
 *
 * 职责：
 * - 图表产出接入既有 `AiDiagramGuard`（Task 4.1）
 * - 守卫拒绝时给出可读原因（Task 4.3）
 * - Mermaid 禁可执行内容断言（Task 4.5）—— 点击回调、脚本、外链资源
 * - 守卫拒绝不使整轮失败：文本结论仍返回（Task 4.7）
 * - 守卫拒绝原因的低敏计数（Task 4.9）
 *
 * 约束：
 * - 不新建校验，复用既 `AiDiagramGuard`（Task 4.1）
 * - Mermaid 禁可执行内容由守卫断言，非前端过滤（D3）
 * - 拒绝原因可读且被分类计数
 */

import type {
  CopilotDiagramBlock,
  CopilotGuardConclusion,
  CopilotGuardRejectionCategory,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 可执行内容检测模式
// ---------------------------------------------------------------------------

/** Mermaid 可执行内容检测正则。 */
const MERMAID_CLICK_CALLBACK = /click\s+["']?[^"'\s]+["']?\s/gi
const MERMAID_SCRIPT = /<script[\s>]/gi
const MERMAID_EXTERNAL_RESOURCE =
  /(?:https?:\/\/|ftp:\/\/|file:\/\/|[a-zA-Z0-9_-]+\.(?:js|css|png|jpg|gif|svg|ico))/gi

// ---------------------------------------------------------------------------
// 守卫拒绝原因分类映射
// ---------------------------------------------------------------------------

interface GuardRejectionClassifyResult {
  category: CopilotGuardRejectionCategory
  detail: string
}

/**
 * 将守卫拒绝原因分类为低敏类别。
 * 用于计数观测（Task 4.9）。
 */
function classifyGuardRejection(reason: string): GuardRejectionClassifyResult {
  const lower = reason.toLowerCase()

  if (lower.includes('click') || lower.includes('callback')) {
    return { category: 'click_callback', detail: 'Mermaid 文本包含点击回调' }
  }
  if (lower.includes('script')) {
    return { category: 'script', detail: 'Mermaid 文本包含脚本内容' }
  }
  if (
    lower.includes('external') ||
    lower.includes('http://') ||
    lower.includes('https://') ||
    lower.includes('.js') ||
    lower.includes('.css')
  ) {
    return { category: 'external_resource', detail: 'Mermaid 文本包含外部资源引用' }
  }
  // 更具体的类别必须先命中：缺 confidence 也算「metadata 不完整」的一种，
  // 先判粗类会把 missing_confidence 永远吞掉，观测里就分不出到底缺的是哪一项。
  if (lower.includes('confidence')) {
    return { category: 'missing_confidence', detail: '图表缺少 confidence' }
  }
  if (lower.includes('metadata')) {
    return { category: 'missing_metadata', detail: '图表 metadata 不完整' }
  }
  if (lower.includes('assumptions')) {
    return { category: 'missing_assumptions', detail: '图表缺少 assumptions' }
  }
  if (lower.includes('missinginputs')) {
    return { category: 'missing_inputs', detail: '图表缺少 missingInputs' }
  }
  if (lower.includes('unsupported') || lower.includes('不支持')) {
    return { category: 'unsupported_type', detail: '图表类型不支持' }
  }

  return { category: 'other', detail: reason }
}

// ---------------------------------------------------------------------------
// 桥接服务
// ---------------------------------------------------------------------------

export interface CopilotDiagramGuardBridgeResult {
  /** 守卫结论。 */
  readonly conclusion: CopilotGuardConclusion
  /** 低敏拒绝计数（供后续观测消费）。 */
  readonly rejectionCount: number
  /** 拒绝原因分类（供计数观测）。 */
  readonly rejectionCategory?: CopilotGuardRejectionCategory
}

/**
 * 检查 Mermaid 文本是否包含可执行内容（Task 4.5）。
 * 返回检测到的可执行内容类型列表。
 */
export function detectMermaidExecutableContent(
  mermaidText: string,
): Array<{ type: CopilotGuardRejectionCategory; detail: string }> {
  const detections: Array<{ type: CopilotGuardRejectionCategory; detail: string }> = []

  // 检查点击回调
  const clickMatches = mermaidText.match(MERMAID_CLICK_CALLBACK)
  if (clickMatches && clickMatches.length > 0) {
    detections.push({
      type: 'click_callback',
      detail: `检测到 ${clickMatches.length} 个点击回调`,
    })
  }

  // 检查脚本
  const scriptMatches = mermaidText.match(MERMAID_SCRIPT)
  if (scriptMatches && scriptMatches.length > 0) {
    detections.push({
      type: 'script',
      detail: `检测到 ${scriptMatches.length} 个脚本标签`,
    })
  }

  // 检查外部资源
  const externalMatches = mermaidText.match(MERMAID_EXTERNAL_RESOURCE)
  if (externalMatches && externalMatches.length > 0) {
    detections.push({
      type: 'external_resource',
      detail: `检测到 ${externalMatches.length} 个外部资源引用`,
    })
  }

  return detections
}

/**
 * 校验 Mermaid 文本的可执行内容守卫断言。
 * Task 4.5: 由守卫断言，非前端过滤。
 *
 * @returns 守卫结论（passed=false 时含拒绝原因与分类）
 */
export function assertMermaidSafe(mermaidText: string): CopilotGuardConclusion {
  const detections = detectMermaidExecutableContent(mermaidText)

  if (detections.length === 0) {
    return { passed: true }
  }

  // detectMermaidExecutableContent 已经给出了精确类别（click_callback / script /
  // external_resource），这里直接用它。原先把它丢掉、再去关键字匹配中文 detail
  // （「检测到 N 个点击回调」），里面既没有 click 也没有 script，于是三类可执行内容
  // 一律落成 other——拦是拦住了，但运营看不出被拦的是哪一类。
  const primaryDetection = detections[0]
  const category = primaryDetection.type

  return {
    passed: false,
    rejectionReason: primaryDetection.detail,
    rejectionCategory: category,
  }
}

/**
 * 图表守卫桥接：校验图表块是否过守卫。
 *
 * Task 4.1: 接入既有 `AiDiagramGuard`，不新建校验。
 * Task 4.3: 守卫拒绝时给出可读原因，不静默降级为文本。
 * Task 4.7: 守卫拒绝不使整轮失败：文本结论仍返回。
 * Task 4.9: 守卫拒绝原因的低敏计数。
 *
 * @param block - 图表块
 * @param guardValidate - 既有守卫校验函数（注入，便于测试 mock）
 */
export function validateDiagramBlock(
  block: CopilotDiagramBlock,
  guardValidate?: (mermaidText: string) => CopilotGuardConclusion,
): CopilotDiagramGuardBridgeResult {
  // 先检查 Mermaid 可执行内容（Task 4.5）
  const executableCheck = assertMermaidSafe(block.mermaidText)
  if (!executableCheck.passed) {
    return {
      conclusion: executableCheck,
      rejectionCount: 1,
      rejectionCategory: executableCheck.rejectionCategory,
    }
  }

  // 使用注入的守卫校验（Task 4.1: 复用既 `AiDiagramGuard`）
  if (guardValidate) {
    const guardResult = guardValidate(block.mermaidText)
    if (!guardResult.passed) {
      const { category } = classifyGuardRejection(guardResult.rejectionReason ?? 'unknown')
      return {
        conclusion: {
          passed: false,
          rejectionReason: guardResult.rejectionReason,
          rejectionCategory: category,
        },
        rejectionCount: 1,
        rejectionCategory: category,
      }
    }
  }

  // 守卫通过
  return {
    conclusion: { passed: true },
    rejectionCount: 0,
  }
}
