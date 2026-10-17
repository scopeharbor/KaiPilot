import logger from '@adonisjs/core/services/logger'
import type User from '#models/user'
import ProjectSignalService from './project_signal_service.js'

/**
 * 项目数据变化后自动检测信号（2026-09-28）。
 *
 * 信号检测此前只有项目级手动端点，且没有任何调用方，`project_signals` 一直是空表，
 * 首页「信号建议」、项目空间信号卡永远没有内容（实测）。首页信号队列按设计是纯被动、
 * 查看零写入，所以不能在查看时检测；改为在任务状态 / 排期变更、AI 草案转正这些写操作
 * 成功之后，后台按规则（零 Token）检测该项目，不阻塞响应。
 *
 * - 同一项目 5 分钟内只检测一次（单节点内存节流），连续拖卡不会反复检测；
 * - 放到下一个事件循环再跑，等写操作的事务提交后读到最新数据；
 * - 任何失败只记日志：绝不让分离的 Promise 抛出未处理拒绝（会拖垮整个后端进程）。
 */
const THROTTLE_MS = 5 * 60 * 1000
const lastRun = new Map<string, number>()

export function scheduleProjectSignalDetection(input: {
  organizationId: number
  projectId: number
  user: User
}): void {
  // 测试环境不做后台检测：分离的异步写会在用例结束后才落库，干扰其它用例
  if (process.env.NODE_ENV === 'test') return
  const key = `${input.organizationId}:${input.projectId}`
  const now = Date.now()
  if (now - (lastRun.get(key) ?? 0) < THROTTLE_MS) return
  lastRun.set(key, now)
  setTimeout(() => {
    new ProjectSignalService()
      .detectAndPersist({
        organizationId: input.organizationId,
        projectId: input.projectId,
        user: input.user,
      })
      .catch((error: unknown) => {
        // 失败时放开节流，下次写操作再试
        lastRun.delete(key)
        logger.warn({ err: error, projectId: input.projectId }, '项目信号自动检测失败')
      })
  }, 0)
}

/** 测试用：清空节流记录。 */
export function resetSignalAutoDetectThrottle(): void {
  lastRun.clear()
}
