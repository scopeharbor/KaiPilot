import { test, expect } from '@playwright/test'
import { API_BASE, loginAsAdmin, setAuthSession } from './_auth-helper'

/**
 * E2E-027：TRIZ 到交付闭环 正向流程（v3-triz-to-delivery-closed-loop §11.10）。
 *
 * 流程：确认决策 → existing-entity link preview/confirm（只写关联）→
 * task 权威状态投影 posture → readiness 取 fingerprint → 人工验证 effective →
 * 更正为 ineffective → reopen 进需重审；全程正式业务表计数零变化。
 * 浏览器面：决策中心页渲染交付闭环四 tab + 只读投影提示。
 *
 * feature flag（TRIZ_DELIVERY_LOOP_ENABLED）由 playwright webServer 启动时注入；
 * 未开启时整组跳过，不把 404 当通过。不依赖真实 provider / 外发动作。
 */

const WIN = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T00:00:00.000Z' }

test.describe('E2E-027: TRIZ 交付闭环 正向流程', () => {
  let session: Awaited<ReturnType<typeof loginAsAdmin>>
  let token: string
  let orgId: number
  let enabled = false
  let projectId = 0
  let taskId = ''
  let decisionLogId = ''
  let itemId = ''

  test.beforeAll(async ({ request }) => {
    session = await loginAsAdmin(request)
    token = session.accessToken
    orgId = session.currentOrganizationId
    const headers = { Authorization: `Bearer ${token}` }

    // 建项目（唯一名，便于定位；E2E 数据留在 dev 库属预期）
    const stamp = Date.now().toString(36)
    const created = await request.post(`${API_BASE}/organizations/${orgId}/projects`, {
      headers,
      data: { name: `E2E-027 交付闭环项目 ${stamp}`, status: 'active', priority: 'medium' },
    })
    expect([200, 201]).toContain(created.status())
    projectId = Number(((await created.json()).data ?? {}).id)

    // flag 探测：开启才继续；关闭时交付闭环 404 与不存在不可区分
    const probe = await request.get(
      `${API_BASE}/projects/${projectId}/triz/delivery-loop/summary`,
      { headers },
    )
    enabled = probe.status() === 200
    if (!enabled) return

    // 建正式实体：决策日志 + 已完成任务
    const task = await request.post(`${API_BASE}/projects/${projectId}/tasks`, {
      headers,
      data: { name: `E2E-027 任务 ${stamp}`, startDate: '2026-08-01', status: 'completed' },
    })
    expect(task.status()).toBe(201)
    taskId = String(((await task.json()).data ?? {}).id)

    const decision = await request.post(`${API_BASE}/projects/${projectId}/triz-decision-logs`, {
      headers,
      data: {
        decisionType: 'adopt',
        subjectRefs: [
          {
            kind: 'analysis_artifact',
            id: `artifact-${stamp}`,
            version: '1',
            summaryLevel: 'low',
            visibility: 'internal',
          },
        ],
        sourceRefs: [{ kind: 'contradiction', id: `contra-${stamp}`, hash: `hash-${stamp}` }],
        artifactHashes: [],
        reasonSummary: 'E2E-027 采纳决策：将交付闭环路线投入执行',
      },
    })
    expect(
      decision.status(),
      `decision create body: ${JSON.stringify(await decision.json())}`,
    ).toBe(201)
    const decisionJson = await decision.json()
    decisionLogId = String(decisionJson.data?.decisionLogId ?? decisionJson.data?.id ?? '')
  })

  test('决策 → link → posture → 人工验证 → 更正 → 重审 全链，正式表零变化', async ({ request }) => {
    test.skip(!enabled, '交付闭环 feature flag 未开启')
    const headers = { Authorization: `Bearer ${token}` }
    const base = `${API_BASE}/projects/${projectId}/triz/delivery-loop`

    // 正式业务基线
    const beforeTasks =
      (
        await (
          await request.get(`${API_BASE}/projects/${projectId}/tasks?perPage=1`, { headers })
        ).json()
      )?.meta?.total ?? -1
    const beforeProjects =
      (
        await (
          await request.get(`${API_BASE}/organizations/${orgId}/projects?perPage=1`, { headers })
        ).json()
      )?.meta?.total ?? -1

    // link preview（零写入）→ confirm（只写关联）
    const preview = await request.post(`${base}/links/preview`, {
      headers,
      data: {
        decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: taskId }],
      },
    })
    expect(preview.status()).toBe(200)
    const previewData = (await preview.json()).data
    expect(previewData.previewFingerprint).toBeTruthy()
    expect(previewData.notice).toMatch(/只写.*关联|不影响/)
    const fingerprint: string = previewData.previewFingerprint

    const confirm = await request.post(`${base}/links/confirm`, {
      headers,
      data: {
        decisionLogId,
        deliveryRefs: [{ kind: 'task', entityId: taskId }],
        previewFingerprint: fingerprint,
        confirmation: { acknowledgedOnlyLinkWrite: true, requestedAt: new Date().toISOString() },
      },
    })
    expect(confirm.status()).toBe(200)
    expect(typeof (await confirm.json()).data.linkId).toBe('number')

    // 列表出现闭环项（已完成任务 → 待人工验证）
    const items = await request.get(`${base}/items?perPage=100`, { headers })
    expect(items.status()).toBe(200)
    const list = ((await items.json()).data ?? []) as Array<{
      itemId: string
      decisionLogId: string
      posture: string
    }>
    const row = list.find((i) => i.decisionLogId === decisionLogId)
    expect(row).toBeTruthy()
    itemId = row!.itemId

    // readiness（零写入）→ fingerprint → 人工验证 effective
    const ready = await request.get(`${base}/items/${encodeURIComponent(itemId)}/ready`, {
      headers,
    })
    expect(ready.status()).toBe(200)
    const readyData = (await ready.json()).data
    expect(readyData.verificationFingerprint).toBeTruthy()

    const verify = await request.post(`${base}/items/${encodeURIComponent(itemId)}/verifications`, {
      headers,
      data: {
        conclusion: 'effective',
        observationWindow: WIN,
        reason: 'E2E-027 人工确认达到预期效果',
        evidenceRefs: ['doc:027'],
        verificationFingerprint: readyData.verificationFingerprint,
      },
    })
    expect(verify.status()).toBe(200)
    const firstEventId = Number((await verify.json()).data.eventId)

    // 更正为 ineffective（supersede 旧事件，历史保留；fingerprint 需取更正后的最新值）
    const ready2Res = await request.get(`${base}/items/${encodeURIComponent(itemId)}/ready`, {
      headers,
    })
    expect(ready2Res.status(), `ready2 body: ${JSON.stringify(await ready2Res.json())}`).toBe(200)
    const ready2 = await ready2Res.json()
    const verifyIneffective = await request.post(
      `${base}/items/${encodeURIComponent(itemId)}/verifications`,
      {
        headers,
        data: {
          conclusion: 'ineffective',
          observationWindow: WIN,
          reason: 'E2E-027 复盘后判定未达预期',
          evidenceRefs: [],
          verificationFingerprint: ready2.data.verificationFingerprint,
          supersedesEventId: firstEventId,
        },
      },
    )
    expect(verifyIneffective.status()).toBe(200)

    // reopen（仅 ineffective/inconclusive 合格）→ 需重审
    const ready3Res = await request.get(`${base}/items/${encodeURIComponent(itemId)}/ready`, {
      headers,
    })
    expect(ready3Res.status(), `ready3 body: ${JSON.stringify(await ready3Res.json())}`).toBe(200)
    const ready3 = await ready3Res.json()
    const reopen = await request.post(`${base}/items/${encodeURIComponent(itemId)}/reopen`, {
      headers,
      data: {
        reason: 'E2E-027 请求重新审查',
        currentFingerprint: ready3.data.verificationFingerprint,
      },
    })
    expect(reopen.status()).toBe(200)

    // 正式业务表零变化（闭环全程只写 link/event/audit）
    const afterTasks =
      (
        await (
          await request.get(`${API_BASE}/projects/${projectId}/tasks?perPage=1`, { headers })
        ).json()
      )?.meta?.total ?? -2
    const afterProjects =
      (
        await (
          await request.get(`${API_BASE}/organizations/${orgId}/projects?perPage=1`, { headers })
        ).json()
      )?.meta?.total ?? -2
    expect(afterTasks).toBe(beforeTasks)
    expect(afterProjects).toBe(beforeProjects)
  })

  test('浏览器：决策中心渲染闭环 tabs 或按 RBAC 优雅降级（非泄露），零脚本错误', async ({
    page,
    request,
  }) => {
    test.skip(!enabled, '交付闭环 feature flag 未开启')
    const projRes = await request.get(`${API_BASE}/organizations/${orgId}/projects?perPage=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const projects = ((await projRes.json()).data ?? []) as Array<{ id: number; code?: string }>
    const demo = projects.find((p) => p.code === 'DEMO') ?? projects[0]
    test.skip(!demo, '没有可用项目')

    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    // 先落到同源页面再注入会话（about:blank 上 sessionStorage 不可读）
    await page.goto('/login')
    await setAuthSession(page, session)
    await page.goto(`/projects/${demo!.id}/triz-decision-center`)
    await page.locator('body').waitFor({ state: 'visible', timeout: 20000 })
    await page.waitForTimeout(1500)
    const bodyText = await page.locator('body').innerText()

    if (bodyText.includes('交付闭环分组')) {
      // 正向：真正渲染出闭环四 tab 与只读投影提示
      await expect(page.getByRole('tablist', { name: '交付闭环分组' })).toBeVisible()
      await expect(page.getByRole('tab', { name: '交付中' })).toBeVisible()
      await expect(page.getByRole('tab', { name: '待验证' })).toBeVisible()
      await expect(page.getByRole('tab', { name: '已验证' })).toBeVisible()
      await expect(page.getByRole('tab', { name: '需重审' })).toBeVisible()
      await expect(page.getByText('闭环状态仅作复盘投影，不改变正式任务状态。')).toBeVisible()
    } else {
      // 降级：种子用户未获 org 级权限时必须优雅显示非泄露提示，而不是崩溃或空白
      expect(bodyText, `page body: ${bodyText.slice(0, 300)}`).toMatch(/无权限|无权访问/)
    }
    expect(pageErrors, `page js errors: ${pageErrors.join('; ')}`).toHaveLength(0)

    await page.screenshot({
      // 证据截图写进本次运行的输出目录（原先写死维护者本机的绝对路径）
      path: test.info().outputPath('e2e-027-decision-center.png'),
      fullPage: true,
    })
  })
})
