/**
 * Deterministic Engine —— 资源负载 baseline。
 *
 * 按 resourceId/date bucket 聚合 capacity、assignedLoad、overload、overloadAmount、taskIds。
 * 只计算负载/超载，不自动调整任务日期或分配。
 *
 * @aiproj/backend
 */

import type {
  GraphValidationResult,
  ResourceLoadBucket,
  ResourceLoadInput,
  ResourceLoadResult,
  ValidationRuleResult,
} from '@aiproj/compiler-spec'
import type { DeterministicContext, ResourceLoadService } from './interfaces.js'
import { isWorkingDay, toDateTime, DEFAULT_CALENDAR } from './working_calendar.js'

export class ResourceLoadCalculator implements ResourceLoadService {
  readonly name = 'resource_load'

  async compute(
    input: ResourceLoadInput,
    _graphValidation: GraphValidationResult,
    context: DeterministicContext,
  ): Promise<ResourceLoadResult> {
    const calendar = context.calendar ?? DEFAULT_CALENDAR
    const warnings: ValidationRuleResult[] = []

    // 检查缺失 capacity
    if (!input.capacities || Object.keys(input.capacities).length === 0) {
      warnings.push({
        ruleId: 'RESOURCE_CAPACITY_MISSING',
        severity: 'warning',
        path: '/blueprint/resources',
        message: '资源 capacity 未提供，无法计算准确负载',
        sourceStageId: 'deterministic_resource_load',
        autoFixable: false,
        requiresHumanReview: false,
        entityIds: [],
      })
    }

    // 按 resourceId + date 聚合
    const bucketMap = new Map<string, ResourceLoadBucket>()
    const resourceIds = new Set<string>()

    // 收集所有涉及资源
    for (const [, resourceId] of Object.entries(input.assignments)) {
      resourceIds.add(resourceId)
    }

    // 遍历所有已排期分配
    for (const [taskId, resourceId] of Object.entries(input.assignments)) {
      const schedule = input.schedules[taskId]
      if (!schedule) continue

      resourceIds.add(resourceId)
      const start = toDateTime(schedule.plannedStart)
      const end = toDateTime(schedule.plannedEnd)

      // 按日遍历日期范围
      let cursor = start
      while (cursor <= end) {
        if (isWorkingDay(cursor, calendar)) {
          const dateStr = cursor.toISODate() ?? ''
          const bucketKey = `${resourceId}::${dateStr}`

          let bucket = bucketMap.get(bucketKey)
          if (!bucket) {
            const capacity = input.capacities?.[resourceId] ?? 0
            bucket = {
              resourceId,
              date: dateStr,
              capacity,
              assignedLoad: 0,
              overload: false,
              overloadAmount: 0,
              taskIds: [],
            }
            bucketMap.set(bucketKey, bucket)
          }

          bucket.assignedLoad += 8 // 默认每任务 8h/天
          if (!bucket.taskIds.includes(taskId)) {
            bucket.taskIds.push(taskId)
          }

          // 重算超载
          if (bucket.capacity > 0 && bucket.assignedLoad > bucket.capacity) {
            bucket.overload = true
            bucket.overloadAmount = bucket.assignedLoad - bucket.capacity
          } else {
            bucket.overload = false
            bucket.overloadAmount = 0
          }
        }
        cursor = cursor.plus({ days: 1 })
      }
    }

    // 输出警告：未提供 capacity 的资源
    if (input.capacities) {
      for (const rid of resourceIds) {
        if (!input.capacities[rid] && input.capacities[rid] !== 0) {
          warnings.push({
            ruleId: 'RESOURCE_CAPACITY_MISSING',
            severity: 'warning',
            path: `/resources/${rid}`,
            message: `资源 ${rid} 未提供 capacity，使用默认值 0`,
            sourceStageId: 'deterministic_resource_load',
            autoFixable: false,
            requiresHumanReview: true,
            entityIds: [rid],
          })
        }
      }
    }

    const buckets = Array.from(bucketMap.values()).sort(
      (a, b) => a.resourceId.localeCompare(b.resourceId) || a.date.localeCompare(b.date),
    )

    const overloadDays = buckets.filter((b) => b.overload).length
    const hasOverload = overloadDays > 0

    return {
      buckets,
      hasOverload,
      overloadDays,
      warnings,
    }
  }
}
