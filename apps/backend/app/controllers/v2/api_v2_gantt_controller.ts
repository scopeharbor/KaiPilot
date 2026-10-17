/**
 * Gantt What-if v2 适配控制器
 *
 * P1：仅当本地会话和影响摘要契约就绪后启用。
 * 保留 preview token、stale、warning/blocker 和显式 Apply 确认边界。
 * 所有读/预览不修改正式进度数据。
 */
import type { HttpContext } from '@adonisjs/core/http'

export default class ApiV2GanttController {
  /**
   * GET /api/v2/projects/:projectId/gantt/whatif
   * 列出 What-if 会话（P1 暂存，返回空列表 + 说明）
   */
  async listSessions({ response }: HttpContext) {
    // P1：待 Gantt What-if 本地会话契约就绪后实现
    return response.ok({
      message: 'Gantt What-if v2 端点已注册，功能待 P1 实现',
      sessions: [],
      status: 'experimental',
    })
  }

  /**
   * GET /api/v2/projects/:projectId/gantt/whatif/:sessionId
   * 获取 What-if 会话详情（P1 暂存）
   */
  async showSession({ response, params }: HttpContext) {
    return response.ok({
      message: `Gantt What-if 会话 ${params.sessionId} — P1 待实现`,
      sessionId: params.sessionId,
      status: 'experimental',
    })
  }

  /**
   * POST /api/v2/projects/:projectId/gantt/whatif/:sessionId/apply
   * 应用 What-if 会话（P1 暂存）
   */
  async applySession({ response, params }: HttpContext) {
    return response.ok({
      message: `Gantt What-if 会话 ${params.sessionId} Apply — P1 待实现`,
      sessionId: params.sessionId,
      status: 'experimental',
    })
  }
}
