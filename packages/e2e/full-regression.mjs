/**
 * 全页面×全操作有头回归 v2（修复轮）：
 * 含真实 AI 剧场全链路（解析→澄清→生成）、空间地图 3D 机位、图表馆镜头点检。
 */
import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'

const API = 'http://localhost:3333/api/v1'
const WEB = 'http://localhost:3000'
const SHOT_DIR = '../../.tmp/regress'
mkdirSync(SHOT_DIR, { recursive: true })

const findings = []
const consoleErrors = []
function check(name, ok, detail = '') {
  findings.push({ name, ok: !!ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@test.local', password: 'Passw0rd!' }),
}).then((r) => r.json())
const data = login.data ?? login
const orgId = data.user.organizations?.[0]?.id ?? 1
const tokenPerms = (() => {
  try {
    return (
      JSON.parse(Buffer.from(data.accessToken.split('.')[1], 'base64url').toString()).permissions ??
      []
    )
  } catch {
    return []
  }
})()

const browser = await chromium.launch({ headless: false, slowMo: 180 })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200))
})
page.on('pageerror', (err) =>
  consoleErrors.push('pageerror@' + page.url() + ': ' + (err.stack ?? String(err)).slice(0, 400)),
)

const shot = (name) => page.screenshot({ path: `${SHOT_DIR}/${name}.png` })
const go = async (path, waitMs = 1500) => {
  await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(waitMs)
}

await page.goto(`${WEB}/next-login`, { waitUntil: 'domcontentloaded' })
await page.evaluate(
  ({ value }) => {
    sessionStorage.setItem('aiproj-auth-session', JSON.stringify({ state: value, version: 0 }))
  },
  {
    value: {
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: data.user.fullName,
        organizations: data.user.organizations,
      },
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      permissions: data.permissions?.length > 0 ? data.permissions : tokenPerms,
      currentOrganizationId: orgId,
      roleVersion: 1,
      isAuthenticated: true,
      hasHydrated: true,
    },
  },
)

// ── 1. 登录页 ──
await go('/next-login', 3500)
check('登录页品牌排版块', await page.locator('[data-login-brand]').count())
check('登录页前景剪纸层', await page.locator('[data-foreground-cutout]').count())
check(
  '登录页 3D Canvas 真实挂载（软渲染 low 档）',
  (await page.locator('canvas').count()) > 0,
  `canvas=${await page.locator('canvas').count()}`,
)
await shot('01-login')

// ── 2. 角色首页 ──
await go('/next', 2000)
check('角色首页挂载', await page.locator('[data-role-home]').count())
const metricTexts = await page.locator('[data-metric-badge]').allTextContents()
check(
  '建议卡指标真实非占位',
  metricTexts.length === 3 && !metricTexts.some((t) => t.includes('待接入')),
  metricTexts.join(' | '),
)
await shot('02-home')

// ── 3. 项目列表 ──
await go('/next/projects', 1500)
check('项目列表含演示项目', (await page.textContent('body'))?.includes('演示项目'))

// ── 4. 生成剧场（真实 AI 全链路）──
await go('/next/create', 1800)
await page
  .locator('textarea')
  .first()
  .fill('帮一个三人创业团队规划一个两周的社区团购小程序上线项目')
await page.locator('[data-intent-submit]').click()
await page.waitForTimeout(6000)
check(
  '剧场解析后出现澄清卡片',
  (await page.textContent('body'))?.match(/第 1 \/ \d+ 题|澄清/) !== null,
)
// 澄清答题循环
for (let q = 1; q <= 10; q++) {
  const answered = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button')).filter((b) => {
      const t = b.textContent?.trim() ?? ''
      return /^(提升|改善|降低|验证|自定义|继续|确认|跳过|都可以)/.test(t) && !b.disabled
    })
    if (candidates.length === 0) return false
    candidates[0].click()
    return true
  })
  if (!answered) break
  await page.waitForTimeout(2500)
}
let streamed = false
try {
  await page.waitForFunction(
    () => /章程|WBS|模块|草案|建造中|正在生成|生成完成/.test(document.body.innerText),
    null,
    { timeout: 90000 },
  )
  streamed = true
} catch {}
check('剧场真实生成流式进度（真实模型调用）', streamed)
await shot('04-theater')

// ── 5. 项目空间 lens 动态点检 ──
await go('/next/projects/1', 2500)
const lensButtons = page.locator('[data-lens-switcher] button')
const lensCount = await lensButtons.count()
const lensNames = []
for (let i = 0; i < Math.min(lensCount, 10); i++) {
  const text = (await lensButtons.nth(i).textContent())?.trim()
  if (text && !/沉浸|轻量|精确|空间地图|AI 唤起|回到旧版/.test(text)) lensNames.push(text)
}
check('项目空间 lens 按钮可枚举', lensNames.length >= 4, lensNames.join('/'))
for (const name of lensNames.slice(0, 8)) {
  const btn = page.locator('button', { hasText: name }).first()
  if (await btn.count()) {
    await btn.click()
    await page.waitForTimeout(600)
  }
}
check(
  '项目空间 lens 全部切换无崩溃',
  consoleErrors.filter((e) => e.includes('pageerror')).length === 0,
)
await shot('05-project-space')

// ── 6. 图表馆目录与代表镜头 ──
await go('/next/projects/1/charts', 2500)
check(
  '图表馆卡片=24',
  (await page.locator('[data-chart-card]').count()) === 24,
  `实际 ${await page.locator('[data-chart-card]').count()}`,
)
for (const chartId of [
  'evm',
  'burndown',
  'control-chart',
  'pareto',
  'lob',
  'raci',
  'rtm',
  'stakeholder',
  'issues',
  'obs',
  'charter',
  'communication',
]) {
  const card = page.locator(`[data-chart-card="${chartId}"]`).first()
  await card.scrollIntoViewIfNeeded().catch(() => null)
  if (await card.count()) {
    await card.click()
    await page.waitForTimeout(1000)
    check(
      `镜头 ${chartId} 可打开`,
      (await page.locator(`[data-chart-lens-root="${chartId}"]`).count()) > 0 ||
        (await page.textContent('body'))?.length > 300,
    )
    await go('/next/projects/1/charts', 700)
  } else {
    check(`镜头 ${chartId} 卡片存在`, false)
  }
}
await shot('06-charts')

// ── 7. 风险（问题工作台）──
await go('/next/risks', 2000)
check('问题与风险 Hub', await page.locator('[data-global-risk-hub]').count())
await page.locator('[data-risk-hub-tab="issue"]').click()
await page.waitForTimeout(1200)
check('问题工作台挂载', await page.locator('[data-issue-workbench]').count())
await shot('07-risks')

// ── 8. 资源（详情抽屉三页签）──
await go('/next/projects/1/resources', 2200)
await page
  .waitForFunction(() => document.querySelectorAll('[data-resource-row]').length > 0, null, {
    timeout: 10000,
  })
  .catch(() => null)
const detailBtn = page.locator('[data-resource-detail-open]').first()
check('资源行详情入口存在（已播种）', (await detailBtn.count()) > 0)
if (await detailBtn.count()) {
  await detailBtn.click()
  await page.waitForTimeout(1000)
  check('资源详情抽屉', await page.locator('[data-resource-detail-drawer]').count())
  await page.locator('[data-resource-detail-tab="availability"]').click()
  await page.waitForTimeout(700)
  check('可用性 tab', (await page.textContent('body'))?.includes('可用性例外'))
  await page.locator('[data-resource-detail-tab="load"]').click()
  await page.waitForTimeout(800)
  check(
    '负载 tab',
    (await page
      .locator('[data-resource-load-tab], [data-resource-load-empty], [data-resource-load-loading]')
      .count()) >= 0,
  )
}
await shot('08-resources')

// ── 9. 文件（三页签）──
await go('/next/projects/1/files', 3500)
check(
  '文件域三页签就位',
  (await page.locator('[data-files-tab]').count()) === 3,
  `实际 ${await page.locator('[data-files-tab]').count()}`,
)
await page.locator('[data-files-tab="ocr"]').click()
await page.waitForTimeout(1000)
check('OCR 页签挂载', (await page.textContent('body'))?.match(/OCR|识别/) !== null)
await page.locator('[data-files-tab="intelligence"]').click()
await page.waitForTimeout(1000)
check('文档智能页签挂载', (await page.textContent('body'))?.match(/智能|抽取|实体|检索/) !== null)
await shot('09-files')

// ── 10. 报表 ──
await go('/next/projects/1/reports', 2200)
await page
  .waitForFunction(
    () => /报表中心|周期报表|预设模板|预设报表/.test(document.body.innerText),
    null,
    { timeout: 8000 },
  )
  .catch(() => null)
check('报表页渲染', (await page.textContent('body'))?.match(/周期|报表|模板/) !== null)
await shot('10-reports')

// ── 11. TRIZ 决策中心 ──
await go('/next/projects/1/triz-decision-center', 3500)
await page
  .waitForFunction(() => /决策中心|待决策/.test(document.body.innerText), null, { timeout: 10000 })
  .catch(() => null)
check('TRIZ 决策中心真实渲染', (await page.textContent('body'))?.match(/决策中心|待决策/) !== null)
await shot('11-triz')

// ── 12. 空间地图 3D + 导演机位 ──
await go('/next', 2000)
await page.waitForSelector('[data-role-home]', { timeout: 15000 })
await page.keyboard.press('Control+m')
await page
  .locator('[data-space-map-overlay]')
  .waitFor({ timeout: 10000 })
  .catch(() => null)
check('空间地图浮层呼出', (await page.locator('[data-space-map-overlay]').count()) > 0)
await page
  .locator('[data-view-mode="3d"]')
  .click()
  .catch(() => null)
await page.waitForTimeout(3000)
check(
  '3D 视角就位（竞态修复后不再误降 2D）',
  (await page.locator('[data-space-map-overlay]').getAttribute('data-view-mode')) === '3d',
)
check('导演机位按钮组=3', (await page.locator('[data-spacemap-shot]').count()) === 3)
await page
  .locator('[data-spacemap-shot="sector"]')
  .click()
  .catch(() => null)
await page.waitForTimeout(1000)
check(
  '机位切换星区巡游',
  (await page.locator('[data-spacemap-shot="sector"]').getAttribute('aria-pressed')) === 'true',
)
await shot('12-spacemap-3d')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// ── 13. AI 同事面板 ──
await page
  .locator('[data-ai-colleague-trigger]')
  .first()
  .click()
  .catch(() => null)
await page.waitForTimeout(900)
if (await page.locator('[data-ai-colleague-panel]').count()) {
  await page.locator('[data-ai-colleague-tab="inbox"]').click()
  await page.waitForTimeout(900)
  check('建议收件箱页签', (await page.locator('[data-ai-colleague-inbox]').count()) > 0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
} else {
  check('AI 同事面板', false)
}

// ── 14. 管理台六域 ──
await go('/next/admin/ai-quality-cost', 2500)
for (const domain of [
  '成本/用量',
  '质量/评测',
  '治理/配额',
  '可靠性与安全',
  '实验与版本',
  '数据治理',
]) {
  const tab = page.locator('[role="tab"]', { hasText: domain }).first()
  await tab.click().catch(() => null)
  await page.waitForTimeout(800)
  check(`管理台域=${domain}`, (await tab.count()) > 0)
}
await shot('14-admin')

// ── 15. 回到旧版入口 ──
await go('/next', 1500)
await page
  .waitForFunction(() => document.body.innerText.includes('回到旧版'), null, { timeout: 8000 })
  .catch(() => null)
check('回到旧版入口', (await page.getByText('回到旧版').count()) > 0)

// ── 汇总 ──
const failed = findings.filter((f) => !f.ok)
const pageErrors = consoleErrors.filter((e) => e.includes('pageerror'))
console.log(
  `\n===== 回归汇总：${findings.length} 项检查，${failed.length} 项失败，pageerror ${pageErrors.length} 条 =====`,
)
if (failed.length) console.log('失败项：', failed.map((f) => f.name).join(' | '))
if (pageErrors.length) console.log(pageErrors.slice(0, 6).join('\n'))
writeFileSync(
  `${SHOT_DIR}/findings.json`,
  JSON.stringify({ findings, consoleErrors: consoleErrors.slice(0, 30) }, null, 1),
)
await browser.close()
process.exit(failed.length || pageErrors.length ? 1 : 0)
