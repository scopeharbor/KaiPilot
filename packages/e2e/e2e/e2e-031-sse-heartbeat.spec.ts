import { test, expect, type Page } from '@playwright/test'
import { API_BASE, setAuthSession, tokenPermissions } from './_auth-helper.js'

/**
 * E2E-031: SSE 心跳 —— 慢模型 25 秒无业务 delta 时 UI 不误报断线
 *
 * 后端以 AI_DRAFT_SLOW_FIRST_CHUNK_MS=25000 启动 MockAdapter：首个 chunk 延迟 25s，
 * 期间 runner 每 5s 发心跳。浏览器必须保持“生成中”，不出现“生成任务已中断”，
 * 最终进入不可确认的审查态（fallback/fixture 不允许确认导入）。
 */

async function createAiEligibleUser(request: import('@playwright/test').APIRequestContext) {
  const email = 'e2e-031-' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '@test.local'
  const res = await request.post(API_BASE + '/auth/register', {
    data: {
      email,
      password: 'Passw0rd!',
      passwordConfirmation: 'Passw0rd!',
      fullName: 'E2E Heartbeat User',
      organizationName: 'E2E Heartbeat Org',
    },
  })
  if (!res.ok()) throw new Error('register failed: ' + (await res.text()).slice(0, 300))
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

const OPTION_LABELS = [
  '提升效率',
  '改善体验',
  '降低风险',
  '验证机会',
  '流程低效',
  '信息不透明',
  '质量不稳定',
  '协作困难',
  '内部团队',
  '外部客户',
  '合作伙伴',
  '管理决策者',
  '效率指标',
  '质量指标',
  '采用指标',
  '业务结果',
  '首期 MVP',
  '验证原型',
  '完整首版',
  '分阶段交付',
  '3–5 人',
  '1–2 人',
  '6–10 人',
  '10 人以上',
  '不迁移',
  '一次性迁移',
  '分批迁移',
  '双轨运行',
  '不需要',
  '暂不',
  '标准',
  '内部标准',
  '高并发活动',
  '实时交互',
  '关键业务',
  '灰度发布',
  '试点',
]

async function answerVisibleCard(page: Page): Promise<boolean> {
  const card = page.locator('article[aria-labelledby^="1.0:"]')
  await expect(card).toHaveCount(1)

  const dateInput = card.locator('input[type="date"]')
  if (await dateInput.isVisible().catch(() => false)) {
    await dateInput.fill('2026-09-01')
    await card.getByRole('button', { name: '回答' }).click()
    return true
  }

  for (const label of OPTION_LABELS) {
    const option = card.getByRole('button', { name: label }).first()
    if (await option.isVisible().catch(() => false)) {
      await option.click()
      return true
    }
  }

  const confirm = card.getByRole('button', { name: /确认已选/ }).first()
  if (await confirm.isVisible().catch(() => false)) {
    const first = card.locator('button[aria-pressed]').first()
    if (await first.isVisible().catch(() => false)) await first.click()
    await confirm.click()
    return true
  }

  const skip = card.getByRole('button', { name: '跳过' })
  if ((await skip.isVisible().catch(() => false)) && !(await skip.isDisabled())) {
    await skip.click()
    return true
  }
  return false
}

async function answerCurrentCard(page: Page, title: string, optionLabel?: string) {
  const card = page.locator('article[aria-labelledby^="1.0:"]')
  await expect(card).toHaveCount(1)
  await expect(card.getByText(title, { exact: false })).toBeVisible()
  if (optionLabel) {
    await card.getByRole('button', { name: optionLabel }).click()
  }
}

test.describe('E2E-031: SSE 心跳与慢模型保活', () => {
  test('25 秒无业务 delta 期间保持生成中，最终进入不可确认审查态', async ({ page, request }) => {
    // 本测试覆盖慢模型 25s 首 chunk + 最长 240s 审查态等待，必须放宽测试级超时
    test.setTimeout(300_000)

    const session = await createAiEligibleUser(request)
    await page.goto('/')
    await setAuthSession(page, session)

    await page.goto('/ai-create')
    const onboarding = page.getByRole('button', { name: '关闭引导' })
    if (await onboarding.isVisible().catch(() => false)) await onboarding.click()

    await page.getByLabel('项目一句话描述').fill('开发一个内部工具，和现有 API 对接')
    await page.getByRole('button', { name: /开始分析/ }).click()

    // 核心层：一次只渲染一张卡（与 e2e-030 同一套已验证选择）
    await answerCurrentCard(page, '目标是什么', '提升效率')
    await answerCurrentCard(page, '核心问题', '流程低效')
    await answerCurrentCard(page, '谁会使用或直接受益', '内部团队')
    await answerCurrentCard(page, '最重要的可验证结果', '效率指标')
    await answerCurrentCard(page, '范围边界', '首期 MVP')
    await answerCurrentCard(page, '多少人参与项目', '3–5 人')

    const dateCard = page.locator('article[aria-labelledby^="1.0:"]')
    await expect(dateCard).toHaveCount(1)
    await expect(dateCard.getByText('项目计划从哪一天开始')).toBeVisible()
    await dateCard.locator('input[type="date"]').fill('2026-09-01')
    await dateCard.getByRole('button', { name: '回答' }).click()

    // 条件层：可能已直接 ready，也可能出条件卡
    const card = page.locator('article[aria-labelledby^="1.0:"]')
    for (let i = 0; i < 12; i += 1) {
      const ready = page.getByRole('button', { name: /开始生成草案/ })
      if (await ready.isVisible().catch(() => false)) break
      await expect(card).toHaveCount(1)
      // 等「ready 按钮」或「当前卡可交互元素」任一出现；最后一步 Agent 追问
      // 慢 mock 约 25s，放宽到 45s
      const readyLoc = page.getByRole('button', { name: /开始生成草案/ })
      const enabledInCard = card
        .locator('button:not([disabled]):visible, input:not([disabled]):visible')
        .first()
      await expect(readyLoc.or(enabledInCard).first()).toBeVisible({ timeout: 45_000 })
      if (await readyLoc.isVisible().catch(() => false)) break

      const dateInput = card.locator('input[type="date"]')
      if (await dateInput.isVisible()) {
        await dateInput.fill('2026-09-01')
        await card.getByRole('button', { name: '回答' }).click()
        await page.waitForTimeout(1200)
        continue
      }

      const hasQuickOptions = (await card.locator('button[aria-pressed], button').count()) > 0
      const custom = card.locator('input[type="text"]')
      if (
        (await custom.isVisible()) &&
        !(await card
          .locator('button')
          .filter({ hasText: /适合|建议/ })
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        await custom.fill('暂不接入')
        await card.getByRole('button', { name: '回答' }).click()
        await page.waitForTimeout(1200)
        continue
      }

      const option = card
        .getByRole('button', {
          name: /不迁移|一次性迁移|不需要|暂不|标准|内部标准|云服务器|自有服务器|Serverless/,
        })
        .first()
      if (await option.isVisible()) {
        await option.click()
        await page.waitForTimeout(1200)
        continue
      }
      const anyOption = card
        .locator('button')
        .filter({ hasText: /建议|标准|内部|不需要|暂不|一次|分批|灰度|试点|SLA|权限|审计/ })
        .first()
      if (await anyOption.isVisible()) {
        await anyOption.click()
        await page.waitForTimeout(1200)
        continue
      }
      const skip = card.getByRole('button', { name: '跳过' })
      if ((await skip.isVisible()) && !(await skip.isDisabled())) {
        await skip.click()
        await page.waitForTimeout(1200)
        continue
      }
      break
    }
    await expect(page.getByRole('button', { name: /开始生成草案/ })).toBeVisible({
      timeout: 20_000,
    })

    // ── 慢模型：25s 无业务 delta，只有心跳 ──────────────
    await page.getByRole('button', { name: /开始生成草案/ }).click()
    await expect(page.getByText(/正在生成项目草案|生成中/).first()).toBeVisible({
      timeout: 10_000,
    })

    await page.waitForTimeout(8_000)
    await expect(page.getByText(/正在生成项目草案|生成中/).first()).toBeVisible({
      timeout: 10_000,
    })
    expect(await page.getByText('生成任务已中断').count()).toBe(0)

    // 最终进入审查态：fixture/mock 草案不可确认导入
    await expect(page.getByText('当前草案不可确认导入')).toBeVisible({ timeout: 240_000 })
    const confirmButtons = page.getByRole('button', { name: /确认导入/ })
    const confirmCount = await confirmButtons.count()
    if (confirmCount > 0) {
      for (let i = 0; i < confirmCount; i += 1) {
        await expect(confirmButtons.nth(i)).toBeDisabled()
      }
    }
  }, 300_000)
})
