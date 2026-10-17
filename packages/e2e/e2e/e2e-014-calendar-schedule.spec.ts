import { test, expect } from '@playwright/test'

/**
 * E2E-014: Calendar 完整模式 — 进入排程模式 / 查看任务区间与里程碑 / 改期后跨视图同步。
 *
 * 与其余 e2e 一致走 API 契约级校验（防御式早退，无种子数据即跳过），
 * 覆盖：截止日模式兼容、schedule 模式派生项与工作日历、itemTypes 过滤、改期后 Calendar 同步。
 */

const API_BASE = 'http://localhost:3333/api/v1'
const TEST_USER = { email: 'admin@test.local', password: 'Passw0rd!' }

test.describe('E2E-014: Calendar Schedule Mode', () => {
  test('schedule 模式契约 + 改期后同步', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, { data: TEST_USER })
    expect(loginRes.ok()).toBeTruthy()
    const { accessToken } = (await loginRes.json()).data
    const auth = { Authorization: `Bearer ${accessToken}` }

    const projRes = await request.get(`${API_BASE}/projects`, { headers: auth })
    expect(projRes.ok()).toBeTruthy()
    const projects = (await projRes.json()).data
    if (projects.length === 0) return
    const projectId = projects[0].id

    // 截止日模式（V1 兼容）仍返回分页任务列表
    const deadlineRes = await request.get(
      `${API_BASE}/projects/${projectId}/calendar?view=month&anchorDate=2026-07-15`,
      { headers: auth },
    )
    expect(deadlineRes.ok()).toBeTruthy()
    const deadlineBody = await deadlineRes.json()
    expect(Array.isArray(deadlineBody.data)).toBeTruthy()
    expect(deadlineBody.meta).toBeTruthy()

    // 完整排程模式：派生日历项 + 工作日历上下文 + meta
    const schedRes = await request.get(
      `${API_BASE}/projects/${projectId}/calendar?mode=schedule&view=month&anchorDate=2026-07-15`,
      { headers: auth },
    )
    expect(schedRes.ok()).toBeTruthy()
    const schedBody = await schedRes.json()
    expect(Array.isArray(schedBody.data)).toBeTruthy()
    expect(schedBody.workingCalendar).toBeTruthy()
    expect(Array.isArray(schedBody.workingCalendar.workdays)).toBeTruthy()
    expect(schedBody.meta).toBeTruthy()
    for (const item of schedBody.data) {
      expect(['task', 'milestone']).toContain(item.kind)
      expect(item.dateRange).toBeTruthy()
    }

    // itemTypes=milestone 仅返回里程碑
    const msRes = await request.get(
      `${API_BASE}/projects/${projectId}/calendar?mode=schedule&view=month&anchorDate=2026-07-15&itemTypes=milestone`,
      { headers: auth },
    )
    expect(msRes.ok()).toBeTruthy()
    for (const item of (await msRes.json()).data) {
      expect(item.kind).toBe('milestone')
    }

    // 改期后 Calendar 同步：挑一个有区间的任务后移 1 天，再次查询应反映新日期
    const taskItem = schedBody.data.find(
      (i: { kind: string; dateRange: { start: string | null; end: string | null } }) =>
        i.kind === 'task' && i.dateRange.start && i.dateRange.end,
    )
    if (!taskItem) return
    const newStart = shiftIso(taskItem.dateRange.start, 1)
    const newEnd = shiftIso(taskItem.dateRange.end, 1)
    const updateRes = await request.patch(
      `${API_BASE}/projects/${projectId}/tasks/${taskItem.sourceId}`,
      {
        headers: auth,
        data: { startDate: newStart, endDate: newEnd },
      },
    )
    // 有权限时应 200，权限不足时 403——两者都不应是 5xx
    expect(updateRes.status()).toBeLessThan(500)
    if (updateRes.ok()) {
      const anchor = newStart.slice(0, 7) + '-15'
      const afterRes = await request.get(
        `${API_BASE}/projects/${projectId}/calendar?mode=schedule&view=month&anchorDate=${anchor}`,
        { headers: auth },
      )
      expect(afterRes.ok()).toBeTruthy()
      const after = (await afterRes.json()).data.find(
        (i: { sourceId: number; kind: string }) =>
          i.kind === 'task' && i.sourceId === taskItem.sourceId,
      )
      if (after) expect(after.dateRange.start).toBe(newStart)
    }
  })
})

function shiftIso(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
