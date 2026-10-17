/**
 * ProjectPredictionActivityMapper —— 预测活动事件映射器。
 *
 * 将预测生命周期事件映射为项目活动事件数据。
 * 输出 { action, metadata } 供下游 ActivityEvent 构造或 Timeline 集成。
 * 摘要使用简体中文，低敏感度。
 *
 * v2-ai-risk-progress-prediction / design D10
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type PredictionActivityEventType =
  | 'prediction_generated'
  | 'prediction_confirmed'
  | 'prediction_dismissed'
  | 'ai_explanation_generated'
  | 'ai_explanation_approved'
  | 'ai_explanation_rejected'
  | 'prediction_referenced_by_report'

export interface PredictionActivityEvent {
  eventType: PredictionActivityEventType
  summary: string
  snapshotId: number
  projectId: number
  organizationId: number
  performedBy: number
  occurredAt: string
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 映射表
// ---------------------------------------------------------------------------

/**
 * eventType → semantic action code 映射。
 * 以 "prediction." 命名空间前缀，下游可据此路由到对应 Timeline 分类/图标。
 */
const EVENT_TYPE_ACTIONS: Record<PredictionActivityEventType, string> = {
  prediction_generated: 'prediction.generated',
  prediction_confirmed: 'prediction.confirmed',
  prediction_dismissed: 'prediction.dismissed',
  ai_explanation_generated: 'prediction.ai_explanation_generated',
  ai_explanation_approved: 'prediction.ai_explanation_approved',
  ai_explanation_rejected: 'prediction.ai_explanation_rejected',
  prediction_referenced_by_report: 'prediction.referenced_by_report',
}

/**
 * 默认中文摘要（event 未提供自定义 summary 时回退）。
 * 低敏感，不含 AI 输出原文、置信度数值、或具体风险细节。
 */
const DEFAULT_SUMMARIES: Record<PredictionActivityEventType, string> = {
  prediction_generated: '生成了项目预测快照',
  prediction_confirmed: '确认了项目预测结果',
  prediction_dismissed: '忽略了项目预测',
  ai_explanation_generated: 'AI 预测解释已生成',
  ai_explanation_approved: '确认了 AI 预测解释',
  ai_explanation_rejected: '驳回了 AI 预测解释',
  prediction_referenced_by_report: '报表中引用了预测数据',
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export default class ProjectPredictionActivityMapper {
  /**
   * 映射预测活动事件 → { action, metadata }。
   *
   * - action：语义化事件码（如 "prediction.generated"），适合下游 Timeline 动词/分类映射。
   * - metadata：结构化上下文字段，含中文摘要、快照 ID、来源项目/组织。低敏感。
   */
  map(event: PredictionActivityEvent): { action: string; metadata: Record<string, unknown> } {
    const action = EVENT_TYPE_ACTIONS[event.eventType]
    const summary = event.summary || DEFAULT_SUMMARIES[event.eventType]

    const metadata: Record<string, unknown> = {
      summary,
      eventType: event.eventType,
      snapshotId: event.snapshotId,
      projectId: event.projectId,
      organizationId: event.organizationId,
      performedBy: event.performedBy,
      occurredAt: event.occurredAt,
    }

    // 合并调用方传入的可选元数据（不覆盖核心字段）
    if (event.metadata) {
      for (const [key, value] of Object.entries(event.metadata)) {
        if (!(key in metadata)) {
          metadata[key] = value
        }
      }
    }

    return { action, metadata }
  }
}
