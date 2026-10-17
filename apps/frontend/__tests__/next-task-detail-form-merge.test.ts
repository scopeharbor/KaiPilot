import { describe, expect, test } from 'vitest'
import {
  mergeDetailForm,
  type DetailFormState,
} from '@/components/next/project-space/WorkspaceTaskDetailDrawer'

const base: DetailFormState = {
  name: '写接口',
  status: 'not_started',
  priority: 'medium',
  assigneeId: '',
  startDate: '2026-10-12',
  endDate: '2026-10-13',
  durationDays: '2',
  progressPercent: 0,
  description: '说明',
}

describe('任务详情表单：服务端刷新时的合并（2026-09-29）', () => {
  test('用户没动过的字段跟服务端走（打勾后的进度 / 状态），动过的保留用户输入', () => {
    const current = { ...base, name: '写导出接口' }
    const server = { ...base, status: 'in_progress' as const, progressPercent: 50 }
    expect(mergeDetailForm(current, base, server)).toEqual({
      ...server,
      name: '写导出接口',
    })
  })

  test('还没有同步基线（首次打开）：整份用服务端数据', () => {
    const server = { ...base, progressPercent: 30 }
    expect(mergeDetailForm(base, null, server)).toEqual(server)
  })
})
