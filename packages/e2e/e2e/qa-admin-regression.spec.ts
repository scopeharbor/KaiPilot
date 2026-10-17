/**
 * 最終 QA：新修復落地後的管理員企業套餐回歸（跑於已就緒的宿主服務）。
 *
 * 前提：dev seed 已將 default-org 升 enterprise（dev_users_seeder 冪等升檔）；
 * 宿主 :3000 為新 build（next start）、:3333 為 watch 後端（/auth/me 帶 planTier）。
 *
 * 斷言：
 *  1. admin@aiproj.local 登入後，/help 與 /dashboard 側欄仍顯示全部企業入口
 *     （設定→安全：企業單點登錄 / KMS / DLP / 合規；管理：AI 質量與成本 / 發布信任中心；多租戶治理）。
 *  2. 直達 /settings/security/kms 返回 200，且 KMS 相關 API 無 403/401（admin enterprise 有權）。
 *
 * 截圖各自落 .tmp/docshots/final/qa-admin-*.png。
 */
import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHOT_DIR = resolve(fileURLToPath(new URL('../../../.tmp/docshots/final', import.meta.url)))

/** 與 plan-tier-navigation 測試同一導航配置清單（lib/navigation 的 enterpriseOnly 條目）。 */
const ENTERPRISE_LINKS = [
  '企业单点登录',
  'KMS 密钥管理',
  'DLP 数据防泄漏',
  '合规准备度',
  'AI 质量与成本',
  '发布信任中心',
  '多租户治理（本组织）',
]

/**
 * 全局多租户治理台需 system:admin（超管哨兵）；組織 owner 即使 enterprise 套餐
 * 也不可見——屬既有權限過濾語義（非套餐門控），此處顯式斷言其隱藏。
 */
const SYSTEM_ADMIN_ONLY_LINK = '多租户治理（全局）'

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.getByPlaceholder('name@example.com').fill('admin@aiproj.local')
  await page.getByPlaceholder('输入密码').fill('password123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  // 登入後側欄出現（桌面 + 移動抽屜可能各一份，取 first）
  await expect(page.getByRole('link', { name: '设置' }).first()).toBeVisible({ timeout: 30000 })
}

async function expectEnterpriseSidebar(page: Page) {
  for (const label of ENTERPRISE_LINKS) {
    await expect(
      page.getByRole('link', { name: label }).first(),
      `側欄缺企業入口：${label}`,
    ).toBeVisible()
  }
  // admin（組織 owner，非超管）不應見全局租戶台（system:admin 哨兵入口）
  await expect(
    page.getByRole('link', { name: SYSTEM_ADMIN_ONLY_LINK }),
    `${SYSTEM_ADMIN_ONLY_LINK} 應僅 system:admin 可見`,
  ).toHaveCount(0)
}

test('QA 回歸：admin 企業側欄於 /help 顯示', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/help')
  await expect(page.getByRole('link', { name: '设置' }).first()).toBeVisible({ timeout: 30000 })
  await expectEnterpriseSidebar(page)
  await page.screenshot({ path: resolve(SHOT_DIR, 'qa-admin-help.png') })
})

test('QA 回歸：admin 企業側欄於 /dashboard 顯示', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: '设置' }).first()).toBeVisible({ timeout: 30000 })
  await expectEnterpriseSidebar(page)
  await page.screenshot({ path: resolve(SHOT_DIR, 'qa-admin-dashboard.png') })
})

test('QA 回歸：直達 /settings/security/kms 200 正常（admin enterprise）', async ({ page }) => {
  await loginAsAdmin(page)
  const kmsResponses: Array<{ url: string; status: number }> = []
  page.on('response', (res) => {
    if (res.url().includes('kms')) kmsResponses.push({ url: res.url(), status: res.status() })
  })
  const res = await page.goto('/settings/security/kms')
  expect(res?.status(), '/settings/security/kms 應 200').toBe(200)
  // 頁面真實渲染出 KMS 工作台（啟用或未啟用態均為正常內容；限定 main 避免撞側欄同名連結）
  await expect(page.locator('main').getByText('KMS 状态').first()).toBeVisible({
    timeout: 30000,
  })
  // 無任何 KMS API 被套餐門控拒掉（企業套餐下 admin 不應見 401/403）
  const denied = kmsResponses.filter((r) => r.status === 401 || r.status === 403)
  expect(denied, `KMS API 被拒：${JSON.stringify(denied)}`).toEqual([])
  await page.screenshot({ path: resolve(SHOT_DIR, 'qa-admin-kms.png') })
})
