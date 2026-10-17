'use client'

/**
 * v3-triz-to-delivery-closed-loop —— advisory plugin/AI draft 区块（task 10.11，P1）。
 *
 * 视觉上与权威事实区分离（dashed border + 「仅供参考」角标）；显示 provenance/
 * fallback/degraded 状态。输出永不进入确认事件——本组件不含任何提交到
 * link/verification/reopen 的按钮。
 */

export interface AdvisoryBlockView {
  capability: string
  content: string
  provenance: string
  version: string
  advisory: true
}

const CAPABILITY_LABELS: Record<string, string> = {
  delivery_template: '交付拆解模板',
  acceptance_metric_suggestion: '验收指标建议',
  effectiveness_rubric: '效果评价 rubric',
  retrospective_draft: '复盘草稿',
}

export function AdvisorySection({
  blocks,
  degradedReasons,
}: {
  blocks: AdvisoryBlockView[]
  degradedReasons: readonly string[]
}) {
  return (
    <section
      aria-label="参考建议（AI 与插件产出）"
      data-testid="dl-advisory-section"
      className="border-dashed"
    >
      <h4>
        参考建议
        <span className="text-xs text-muted-foreground">（仅供参考 · 不进入确认事件）</span>
      </h4>

      {degradedReasons.length > 0 ? (
        <p role="status" data-testid="dl-advisory-degraded">
          方法建议部分暂不可用：
          {degradedReasons.map((r) => (
            <span key={r} className="mr-1">
              {degradedLabel(r)}
            </span>
          ))}
          核心闭环信息不受影响。
        </p>
      ) : null}

      {blocks.length === 0 ? (
        <p data-testid="dl-advisory-empty">暂无可用的方法建议。</p>
      ) : (
        <ul>
          {blocks.map((b) => (
            <li key={`${b.capability}:${b.provenance}`} data-testid="dl-advisory-block">
              <strong>{CAPABILITY_LABELS[b.capability] ?? b.capability}</strong>
              <span className="text-xs text-muted-foreground">
                （来源 {b.provenance} · v{b.version} · 草稿）
              </span>
              <div>{b.content}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function degradedLabel(reason: string): string {
  const map: Record<string, string> = {
    plugin_disabled: '插件未启用',
    plugin_uninstalled: '插件已卸载',
    plugin_timeout: '插件响应超时',
    payload_oversize: '载荷超限',
    invalid_output: '无效输出',
    forbidden_content: '含不允许内容',
    partial_failure: '部分失败',
    ai_unavailable: 'AI 未接入',
  }
  return map[reason] ?? reason
}
