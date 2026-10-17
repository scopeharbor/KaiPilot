import ApiException from '#exceptions/api_exception'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

export interface TaskBatchItemError {
  code: string
  message: string
}

export type TaskBatchItemResult<T> =
  | { taskId: number; success: true; value: T }
  | { taskId: number; success: false; error: TaskBatchItemError }

export interface TaskBatchResult<T> {
  total: number
  successCount: number
  failedCount: number
  results: TaskBatchItemResult<T>[]
}

/**
 * 批量事务编排器：每项独立事务、顺序执行、跨项部分成功。
 * 授权与具体领域动作由 controller 提供的回调完成。
 */
/** PostgreSQL 下批量任务的并发度（与连接池上限留足余量）。 */
const BATCH_CONCURRENCY = 5

export default class TaskBatchService {
  async execute<T>(
    taskIds: number[],
    operation: (taskId: number, client: TransactionClientContract) => Promise<T>,
    authorize?: (taskId: number) => Promise<void>,
  ): Promise<TaskBatchResult<T>> {
    const results: TaskBatchItemResult<T>[] = new Array(taskIds.length)
    const runOne = async (index: number) => {
      const taskId = taskIds[index]!
      try {
        await authorize?.(taskId)
        const value = await db.transaction((client) => operation(taskId, client))
        results[index] = { taskId, success: true, value }
      } catch (error) {
        results[index] = { taskId, success: false, error: this.toItemError(error) }
      }
    }

    // 每项独立事务。PostgreSQL 上以有限并发执行（远端库单次往返 ~130ms、每项十几次查询，
    // 顺序执行 200 个任务要数分钟）；SQLite 单写连接只能顺序执行。结果顺序与请求一致。
    const concurrency = db.connection().dialect.name === 'postgres' ? BATCH_CONCURRENCY : 1
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(concurrency, taskIds.length) }, async () => {
        while (cursor < taskIds.length) {
          const index = cursor++
          await runOne(index)
        }
      }),
    )

    const successCount = results.filter((result) => result.success).length
    return {
      total: taskIds.length,
      successCount,
      failedCount: taskIds.length - successCount,
      results,
    }
  }

  private toItemError(error: unknown): TaskBatchItemError {
    if (error instanceof ApiException) {
      return { code: error.code ?? 'API_ERROR', message: error.message }
    }

    logger.error({ err: error }, 'task batch item failed')
    return {
      code: 'INTERNAL_ERROR',
      message: '任务处理失败，请稍后重试',
    }
  }
}
