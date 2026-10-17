/**
 * GET /api/v1/ai/live-output/:id —— 订阅实时输出频道（SSE）。
 *
 * 意图分析 / 项目理解是一次性返回 JSON 的请求，等待期间用这个旁路通道看到模型正在吐出的文字。
 * 只读、只推送本人（组织 + 用户）的频道；频道关闭（请求结束）后发送 end 事件并断开。
 */
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { PermissionDeniedException, ValidationException } from '#exceptions/api_exception'
import {
  isLiveOutputId,
  liveOutputHub,
  liveOutputOwner,
} from '#services/ai_live_output/live_output_hub'

/** 覆盖 25 分钟自适应分析整轮；即使模型不输出思考 token，仍用 SSE 注释心跳保活。 */
const MAX_SUBSCRIBE_MS = 30 * 60_000

export default class AiLiveOutputController {
  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = Number(ctx.tenant?.organizationId)
    if (!organizationId) throw new PermissionDeniedException('缺少组织上下文')
    const id = ctx.params.id
    if (!isLiveOutputId(id)) throw new ValidationException('实时输出编号无效')
    const owner = liveOutputOwner(organizationId, user.id)
    // 订阅可能先于请求到达：先占下频道并绑定归属，之后请求方以同一归属写入。
    if (!liveOutputHub.claim(id, owner)) throw new PermissionDeniedException('无权订阅该实时输出')

    const raw = ctx.response.response
    const origin = ctx.request.header('origin')
    if (origin) {
      raw.setHeader('Access-Control-Allow-Origin', origin)
      raw.setHeader('Access-Control-Allow-Credentials', 'true')
      raw.setHeader('Vary', 'Origin')
    }
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache, no-transform')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('X-Accel-Buffering', 'no')
    raw.flushHeaders?.()

    const write = (event: string, data: unknown) => {
      if (raw.destroyed || raw.writableEnded) return false
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      const flush = (raw as typeof raw & { flush?: () => void }).flush
      if (typeof flush === 'function') flush.call(raw)
      return true
    }

    const deadline = Date.now() + MAX_SUBSCRIBE_MS
    let offset = 0
    while (Date.now() < deadline) {
      const batch = liveOutputHub.read(id, owner, offset)
      if (!batch) break
      offset = batch.next
      for (const piece of batch.pieces) {
        if (!write('output', piece)) return
      }
      if (batch.closed) break
      await liveOutputHub.waitForChange(id, 15_000)
      // 保活：代理 / 浏览器不会因长时间无数据断开。
      if (!raw.destroyed && !raw.writableEnded) raw.write(': keep-alive\n\n')
    }
    write('end', {})
    if (!raw.writableEnded) raw.end()
  }
}
