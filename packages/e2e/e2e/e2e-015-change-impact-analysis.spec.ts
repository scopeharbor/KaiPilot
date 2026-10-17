import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

/**
 * E2E-015: V2 变更影响分析 — 生成快照、审批引用、实施关闭、审计/Timeline 可追溯
 */

const API_BASE = 'http://localhost:3333/api/v1'
const REQUESTER = { email: 'admin@test.local', password: 'Passw0rd!' }
const APPROVER = { email: 'org-admin@aiproj.local', password: 'password123' }

async function login(request: APIRequestContext, user: typeof REQUESTER) {
  const res = await request.post(`${API_BASE}/auth/login`, { data: user })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).data.accessToken as string
}

test.describe('E2E-015: Change Impact Analysis', () => {
  test('提交变更请求 -> 生成影响分析 -> 审批引用 -> 实施关闭 -> 审计/活动可查', async ({
    request,
  }) => {
    const requesterToken = await login(request, REQUESTER)
    const approverToken = await login(request, APPROVER)

    const projectsRes = await request.get(`${API_BASE}/projects`, {
      headers: { Authorization: `Bearer ${requesterToken}` },
    })
    expect(projectsRes.ok()).toBeTruthy()
    const projects = (await projectsRes.json()).data
    expect(projects.length).toBeGreaterThan(0)
    const projectId = projects[0].id

    const createCrRes = await request.post(`${API_BASE}/projects/${projectId}/change-requests`, {
      headers: { Authorization: `Bearer ${requesterToken}` },
      data: {
        title: `E2E 影响分析 ${Date.now()}`,
        description: '验证影响分析必须作为审批证据，而不是自动执行。',
        changeType: 'scope',
        priority: 'high',
      },
    })
    expect(createCrRes.ok()).toBeTruthy()
    const changeRequestId = (await createCrRes.json()).data.id

    const submitRes = await request.post(`${API_BASE}/change-requests/${changeRequestId}/submit`, {
      headers: { Authorization: `Bearer ${requesterToken}` },
    })
    expect(submitRes.ok()).toBeTruthy()

    const analysisRes = await request.post(
      `${API_BASE}/projects/${projectId}/change-requests/${changeRequestId}/impact-analyses`,
      {
        headers: { Authorization: `Bearer ${requesterToken}` },
        data: { scope: { dimensions: ['scope', 'schedule', 'resource', 'risk', 'quality'] } },
      },
    )
    expect(analysisRes.ok()).toBeTruthy()
    const analysis = (await analysisRes.json()).data
    expect(analysis.changeRequestId).toBe(changeRequestId)
    expect(analysis.status).toBe('completed')
    expect(analysis.inputSignature).toContain('v2-')

    const approveRes = await request.post(
      `${API_BASE}/change-requests/${changeRequestId}/approve`,
      {
        headers: { Authorization: `Bearer ${approverToken}` },
        data: {
          decisionReason: '已审阅影响分析，批准进入人工实施。',
          impactAnalysisId: analysis.id,
        },
      },
    )
    expect(approveRes.ok()).toBeTruthy()
    const approved = (await approveRes.json()).data
    expect(approved.status).toBe('approved')
    expect(Number(approved.approveRefAnalysisId)).toBe(analysis.id)

    const implementedRes = await request.post(
      `${API_BASE}/change-requests/${changeRequestId}/mark-implemented`,
      { headers: { Authorization: `Bearer ${requesterToken}` } },
    )
    expect(implementedRes.ok()).toBeTruthy()

    const closeRes = await request.post(`${API_BASE}/change-requests/${changeRequestId}/close`, {
      headers: { Authorization: `Bearer ${approverToken}` },
    })
    expect(closeRes.ok()).toBeTruthy()
    expect((await closeRes.json()).data.status).toBe('closed')

    const auditRes = await request.get(
      `${API_BASE}/audit-logs?entityType=change_impact_analysis&entityId=${analysis.id}`,
      { headers: { Authorization: `Bearer ${approverToken}` } },
    )
    expect(auditRes.ok()).toBeTruthy()
    const auditLogs = (await auditRes.json()).data || []
    expect(
      auditLogs.some((log: { event?: string }) => log.event === 'CHANGE_IMPACT_APPROVE_REFERENCED'),
    ).toBeTruthy()

    const timelineRes = await request.get(`${API_BASE}/projects/${projectId}/timeline`, {
      headers: { Authorization: `Bearer ${approverToken}` },
    })
    expect(timelineRes.ok()).toBeTruthy()
    const timelineItems = (await timelineRes.json()).data || []
    expect(
      timelineItems.some(
        (item: { objectType?: string; summary?: string }) =>
          item.objectType === 'change_impact_analysis' || item.summary?.includes('影响分析'),
      ),
    ).toBeTruthy()
  })
})
