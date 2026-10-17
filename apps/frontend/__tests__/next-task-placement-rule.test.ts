/**
 * v3-ui-next-project-space tasks 3.2 —— 放置建任务规则式补全引擎单元测试。
 *
 * 覆盖 design D5 / tasks 3.1 的纯函数契约：
 * - 输入去首尾空白提取任务名称（空输入返回 null）；
 * - 放置目标列初始状态继承（in_progress 列 → in_progress，其余 → not_started）；
 * - 默认工期 1 天（8 小时）、今天锚点开始日期、中优先级、未分配负责人；
 * - AIMarker 结构完整性（source/confidence/needsConfirmation/reason）；
 * - buildPlacementCreateInput 组装契约为空字段省略、不携带 marker。
 */
import { describe, expect, test } from 'vitest'
import type { KanbanColumn } from '@/lib/api/kanban'
import {
  buildPlacementCreateInput,
  createPlacementMarker,
  formatDateKey,
  inferTaskPlacementDraft,
  PLACEMENT_CONFIDENCE,
  PLACEMENT_DEFAULT_DURATION_DAYS,
  PLACEMENT_DEFAULT_ESTIMATED_HOURS,
  PLACEMENT_DEFAULT_PRIORITY,
  PLACEMENT_DEFAULT_TASK_TYPE,
  PLACEMENT_MARKER_REASON,
  targetStatusForColumn,
} from '@/lib/next/task-placement-rule'

const TODAY = new Date(2026, 8, 9) // 2026-09-09 本地时区

const ALL_COLUMNS: KanbanColumn[] = ['pending', 'in_progress', 'completed', 'other']

describe('lib/next/task-placement-rule（D5 规则式补全引擎 / 任务 3.1）', () => {
  test('输入去首尾空白提取任务名称（trim）', () => {
    const draft = inferTaskPlacementDraft('  完成用户鉴权接口测试  ', 'pending', TODAY)
    expect(draft).not.toBeNull()
    expect(draft!.name).toBe('完成用户鉴权接口测试')
  })

  test('空白/空输入返回 null（调用方保持输入态，零补全零请求）', () => {
    expect(inferTaskPlacementDraft('', 'pending', TODAY)).toBeNull()
    expect(inferTaskPlacementDraft('   ', 'in_progress', TODAY)).toBeNull()
  })

  test('放置目标列初始状态继承：in_progress 列 → in_progress，其余 → not_started', () => {
    expect(targetStatusForColumn('in_progress')).toBe('in_progress')
    for (const column of ALL_COLUMNS) {
      if (column === 'in_progress') continue
      expect(targetStatusForColumn(column)).toBe('not_started')
      expect(inferTaskPlacementDraft('任意任务', column, TODAY)!.status).toBe('not_started')
    }
    expect(inferTaskPlacementDraft('进行中任务', 'in_progress', TODAY)!.status).toBe('in_progress')
  })

  test('默认工期 1 天（8 小时）与中优先级、task 类型、未分配负责人', () => {
    const draft = inferTaskPlacementDraft('整理验收清单', 'completed', TODAY)!
    expect(draft.durationDays).toBe(PLACEMENT_DEFAULT_DURATION_DAYS)
    expect(draft.durationDays).toBe(1)
    expect(draft.estimatedHours).toBe(PLACEMENT_DEFAULT_ESTIMATED_HOURS)
    expect(draft.estimatedHours).toBe(8)
    expect(draft.priority).toBe(PLACEMENT_DEFAULT_PRIORITY)
    expect(draft.priority).toBe('medium')
    expect(draft.taskType).toBe(PLACEMENT_DEFAULT_TASK_TYPE)
    expect(draft.assigneeId).toBeNull()
    expect(draft.endDate).toBeNull()
  })

  test('开始日期对齐今天锚点（本地 YYYY-MM-DD）', () => {
    const draft = inferTaskPlacementDraft('撞库演练', 'pending', TODAY)!
    expect(draft.startDate).toBe('2026-09-09')
    expect(draft.startDate).toBe(formatDateKey(TODAY))
  })

  test('AIMarker 结构完整性：rule_based / 0.85 / 待确认 / 中文 reason', () => {
    const draft = inferTaskPlacementDraft('回归测试脚本', 'other', TODAY)!
    const marker = draft.marker
    expect(marker.source).toBe('rule_based')
    expect(marker.confidence).toBe(PLACEMENT_CONFIDENCE)
    expect(marker.confidence).toBe(0.85)
    expect(marker.needsConfirmation).toBe(true)
    expect(marker.reason).toBe(PLACEMENT_MARKER_REASON)
    expect(marker.reason).toBe('根据放置目标列与上下文默认推断')

    const direct = createPlacementMarker()
    expect(direct).toEqual({
      source: 'rule_based',
      confidence: 0.85,
      needsConfirmation: true,
      reason: '根据放置目标列与上下文默认推断',
    })
  })

  test('buildPlacementCreateInput：仅搬运业务字段、省略 null、绝不携带 AIMarker', () => {
    const draft = inferTaskPlacementDraft('数据库索引优化', 'in_progress', TODAY)!
    const input = buildPlacementCreateInput(draft)
    expect(input).toEqual({
      name: '数据库索引优化',
      status: 'in_progress',
      priority: 'medium',
      taskType: 'task',
      startDate: '2026-09-09',
      durationDays: 1,
      estimatedHours: 8,
    })
    expect('marker' in input).toBe(false)
    expect('endDate' in input).toBe(false)
    expect('assigneeId' in input).toBe(false)
  })

  test('buildPlacementCreateInput：就地微调覆盖工期与优先级、显式负责人透传', () => {
    const draft = inferTaskPlacementDraft('跨日联调', 'pending', TODAY)!
    const input = buildPlacementCreateInput(draft, {
      durationDays: 3,
      priority: 'high',
      assigneeId: 7,
      startDate: '2026-09-10',
    })
    expect(input.durationDays).toBe(3)
    expect(input.priority).toBe('high')
    expect(input.assigneeId).toBe(7)
    expect(input.startDate).toBe('2026-09-10')
    // 未覆盖字段保持默认（estimatedHours 固定 8 小时契约）
    expect(input.estimatedHours).toBe(8)
    expect(input.status).toBe('not_started')
  })
})
