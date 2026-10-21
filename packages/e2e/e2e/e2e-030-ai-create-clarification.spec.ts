import { test, expect, type Page } from '@playwright/test'
import { API_BASE, setAuthSession, tokenPermissions } from './_auth-helper.js'

async function createAiEligibleUser(request: import('@playwright/test').APIRequestContext) {
  const email = 'e2e-030-' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '@test.local'
  const res = await request.post(API_BASE + '/auth/register', {
    data: {
      email,
      password: 'Passw0rd!',
      passwordConfirmation: 'Passw0rd!',
      fullName: 'E2E AI User',
      organizationName: 'E2E AI Org',
    },
  })
  if (!res.ok()) throw new Error('register failed: ' + (await res.text()).slice(0, 300))

  // 复用既有登录解析：register 与 login 的会话形状一致，走 login 得到带权限的权威会话。
  const login = await request.post(API_BASE + '/auth/login', {
    data: { email, password: 'Passw0rd!' },
  })
  if (!login.ok()) throw new Error('login after register failed')
  const body = await login.json()
  const data = body.data ?? body
  const user = data.user ?? data
  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      organizations: user.organizations,
    },
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    permissions:
      data.permissions?.length > 0 ? data.permissions : tokenPermissions(data.accessToken),
    currentOrganizationId: user.organizations?.[0]?.id ?? 1,
    roleVersion: 1,
    isAuthenticated: true,
  }
}

/**
 * E2E-030: AI 快速创建 —— 三层逐题澄清、刷新恢复、草案审查不可自动导入
 *
 * 覆盖 task 6.3：逐一完成核心问题 → 验证剩余计数 → 触发条件卡片 →
 * 刷新恢复 → 生成并审查草案；断言任何阶段都不同时渲染多张问题卡、
 * 草案生成不自动导入项目。
 */
const INPUT = '开发一个内部工具，和现有 API 对接'

async function answerCurrentCard(page: Page, title: string, optionLabel?: string) {
  const card = page.locator('article[aria-labelledby^="1.0:"]')
  await expect(card).toHaveCount(1)
  await expect(card.getByText(title, { exact: false })).toBeVisible()
  if (optionLabel) {
    await card.getByRole('button', { name: optionLabel }).click()
  }
}

test.describe('E2E-030: AI 快速创建逐题澄清与草案审查', () => {
  test('逐题完成核心+条件、刷新恢复并审查草案（零自动导入）', async ({ page, request }) => {
    // 逐题澄清 + 刷新恢复 + 草案生成整条链路，dev 按需编译下远超默认 30s
    test.setTimeout(300_000)
    const session = await createAiEligibleUser(request)
    // 在不会自动跳转的 /login 上写入会话；根路由 / 会在水合后 replace 跳转，与下一次 goto 竞争导致 ERR_ABORTED
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await setAuthSession(page, session)

    await page.goto('/ai-create')
    const onboarding = page.getByRole('button', { name: '关闭引导' })
    if (await onboarding.isVisible().catch(() => false)) await onboarding.click()
    await page.getByLabel('项目一句话描述').fill(INPUT)
    await page.getByRole('button', { name: /开始分析/ }).click()

    // ── 核心层：一次只渲染一张卡 ──────────────────────────────
    await answerCurrentCard(page, '目标是什么', '提升效率')
    await answerCurrentCard(page, '核心问题', '流程低效')
    await answerCurrentCard(page, '谁会使用或直接受益', '内部团队')
    await answerCurrentCard(page, '最重要的可验证结果', '效率指标')
    await answerCurrentCard(page, '范围边界', '首期 MVP')
    await answerCurrentCard(page, '多少人参与项目？', '3–5 人')

    // 日期题：自定义输入 + 回答按钮
    const dateCard = page.locator('article[aria-labelledby^="1.0:"]')
    await expect(dateCard).toHaveCount(1)
    await expect(dateCard.getByText('项目计划从哪一天开始')).toBeVisible()
    await dateCard.locator('input[type="date"]').fill('2026-09-01')
    await dateCard.getByRole('button', { name: '回答' }).click()

    // 断言剩余计数在核心阶段出现过
    await expect(page.getByText(/还剩 \d+ 题/).first()).toBeVisible()

    // ── 刷新恢复：回答后刷新，仍处于澄清流程且答案保留 ─────────
    await page.reload()
    await expect(page.getByLabel('项目一句话描述')).toHaveValue(INPUT)

    // ── 条件层：和现有 API 对接触发 integration-migration 卡片组；若已被预填解析则直接 ready ──
    const card = page.locator('article[aria-labelledby^="1.0:"]')
    const ready = page.getByRole('button', { name: /开始生成草案/ })
    for (let i = 0; i < 12; i += 1) {
      if (await ready.isVisible().catch(() => false)) break
      await expect(card).toHaveCount(1)
      // 回答后上一张卡的选项会先变为禁用、再换成下一题：等到 ready 或当前卡有可交互元素再判断，
      // 否则会点到上一题已禁用的选项而一直等下去
      const enabledInCard = card
        .locator('button:not([disabled]):visible, input:not([disabled]):visible')
        .first()
      await expect(ready.or(enabledInCard).first()).toBeVisible({ timeout: 45_000 })
      if (await ready.isVisible().catch(() => false)) break

      const option = card
        .getByRole('button', { name: /不迁移|一次性迁移|不需要|暂不|标准|内部标准/ })
        .first()
      if ((await option.isVisible()) && (await option.isEnabled())) {
        await option.click()
        await page.waitForTimeout(1200)
        continue
      }
      const dateInput = card.locator('input[type="date"]')
      if ((await dateInput.isVisible()) && (await dateInput.isEnabled())) {
        await dateInput.fill('2026-09-01')
        await card.getByRole('button', { name: '回答' }).click()
        await page.waitForTimeout(1200)
        continue
      }
      const anyOption = card
        .locator('button:not([disabled])')
        .filter({ hasText: /建议|标准|内部|不需要|暂不|一次|分批|灰度|试点/ })
        .first()
      if (await anyOption.isVisible()) {
        await anyOption.click()
        await page.waitForTimeout(1200)
        continue
      }
      // 只有自定义输入的题（如「计划使用哪些第三方服务？」）：填一个保守答案
      const custom = card.locator('input[type="text"]:not([disabled])')
      if (await custom.isVisible()) {
        await custom.fill('暂不接入')
        await card.getByRole('button', { name: '回答' }).click()
        await page.waitForTimeout(1200)
        continue
      }
      const skip = card.getByRole('button', { name: '跳过' })
      if ((await skip.isVisible()) && (await skip.isEnabled())) {
        await skip.click()
        await page.waitForTimeout(1200)
        continue
      }
      break
    }

    // 条件完成后应进入 ready（或 Agent 追问，可跳过）；最终出现生成按钮
    await expect(page.getByRole('button', { name: /开始生成草案/ })).toBeVisible({
      timeout: 20_000,
    })

    // ── 生成并审查：确定性/mock 草案不得确认导入 ────────────────
    const projectCountBefore = (
      await (
        await request.get(`${API_BASE}/projects`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        })
      ).json()
    ).data.length

    await page.getByRole('button', { name: /开始生成草案/ }).click()

    // 五阶段生成 + 质量闭环在 dev 服务器上要几十秒
    await expect(page.getByText('当前草案不可确认导入')).toBeVisible({ timeout: 120_000 })
    const confirmButtons = page.getByRole('button', { name: /确认导入/ })
    const confirmCount = await confirmButtons.count()
    if (confirmCount > 0) {
      for (let i = 0; i < confirmCount; i += 1) {
        await expect(confirmButtons.nth(i)).toBeDisabled()
      }
    }

    const projectCountAfter = (
      await (
        await request.get(`${API_BASE}/projects`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        })
      ).json()
    ).data.length
    expect(projectCountAfter).toBe(projectCountBefore)
  })
})
