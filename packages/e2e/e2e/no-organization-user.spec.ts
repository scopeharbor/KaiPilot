import { test, expect } from '@playwright/test'
import { setAuthSession, API_BASE } from './_auth-helper'

/**
 * 回归测试（个人/无组织账号修复，前端侧）：
 * 组织上下文缺失（currentOrganizationId=null / organizations=[]）时，
 * 关键页面必须渲染「请先选择组织」引导且不崩溃。
 *
 * 用户态构造：register 拿真实 token（保证页面内全局 API 调用可正常 refresh，
 * 不会因鉴权失败被登出），但注入的会话视图为「无组织」（organizations=[]、
 * currentOrganizationId=null）——页面的 org=null 分支走纯前端渲染，
 * 不发请求（TanStack Query `enabled` 已暂停）。后端的无组织行为由
 * `apps/backend/tests/functional/auth/no_org_user_endpoints.spec.ts` 覆盖。
 */
test.describe('无组织用户：关键页面渲染引导且不崩', () => {
  async function createSessionGrant(request: import('@playwright/test').APIRequestContext) {
    const email = `google-noorg-e2e-${Date.now()}@example.com`
    const reg = await request.post(`${API_BASE}/auth/register`, {
      data: {
        fullName: 'E2E 无组织用户',
        email,
        password: 'Passw0rd!',
        passwordConfirmation: 'Passw0rd!',
      },
    })
    expect(reg.ok()).toBeTruthy()
    const body = (await reg.json()).data
    return {
      user: { ...body.user, organizations: [] },
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      permissions: body.permissions ?? [],
    }
  }

  async function seedNoOrgSession(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
  ) {
    const grant = await createSessionGrant(request)
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await setAuthSession(page, {
      ...grant,
      currentOrganizationId: null,
      roleVersion: 0,
      isAuthenticated: true,
    } as never)
    // dev 模式按需编译：预热组织页面一次，避免首次编译超时干扰断言
    await page
      .goto('/organization', { waitUntil: 'domcontentloaded', timeout: 60_000 })
      .catch(() => {})
    await page.waitForTimeout(3000)
  }

  test('org=null 用户访问项目/组织页面显示「请先选择组织」', async ({ page, request }) => {
    // dev 按需编译下四个路由逐个冷编译，放宽测试级超时（断言本身仍 30s）
    test.setTimeout(120_000)
    await seedNoOrgSession(page, request)

    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err.message ?? err)))

    for (const url of ['/projects', '/projects/new', '/settings/organization', '/organization']) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      try {
        await expect(page.getByText('请先选择组织').first()).toBeVisible({ timeout: 30_000 })
      } catch {
        const body = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
        console.log(`DIAG[${url}]`, body.replace(/\n+/g, ' | ').slice(0, 400))
        throw new Error(`missing guide on ${url}`)
      }
    }
    expect(pageErrors).toEqual([])
  })

  test('org=null 用户访问详情页（/projects/1）不崩溃', async ({ page, request }) => {
    // dev 按需编译下详情页冷编译较慢，放宽测试级超时
    test.setTimeout(90_000)
    await seedNoOrgSession(page, request)

    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err.message ?? err)))

    await page.goto('/projects/1', { waitUntil: 'domcontentloaded' })
    // 会话恢复与 dev 冷编译期间先显示「正在载入」，等任一引导/降级文案出现，而不是固定等待
    await expect(page.getByText(/请先选择组织|项目不存在|没有权限|加载失败/).first()).toBeVisible({
      timeout: 30_000,
    })
    expect(pageErrors).toEqual([])
  })

  test('org=null 用户访问 /organization/okrs 显示引导', async ({ page, request }) => {
    await seedNoOrgSession(page, request)
    await page.goto('/organization/okrs', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('请先选择组织').first()).toBeVisible({ timeout: 30_000 })
  })
})

/**
 * 个人组织用户（Google 新账号默认落地：free 个人组织 + owner membership）：
 * 关键页面必须可正常渲染/给出组件级降级态，且无未捕获异常。
 * 使用 register 签发的真实 token（org 真实存在，API 全部可达）。
 */
test.describe('个人组织用户：关键页面不崩', () => {
  async function seedPersonalOrgSession(
    page: import('@playwright/test').Page,
    request: import('@playwright/test').APIRequestContext,
  ) {
    const email = `google-personal-e2e-${Date.now()}@example.com`
    const reg = await request.post(`${API_BASE}/auth/register`, {
      data: {
        fullName: 'E2E 个人组织用户',
        email,
        password: 'Passw0rd!',
        passwordConfirmation: 'Passw0rd!',
      },
    })
    expect(reg.ok()).toBeTruthy()
    const body = (await reg.json()).data
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await setAuthSession(page, {
      user: body.user,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      permissions: body.permissions ?? [],
      currentOrganizationId: body.user.organizations[0].id,
      roleVersion: 0,
      isAuthenticated: true,
    } as never)
  }

  test('关键页面渲染且无未捕获异常', async ({ page, request }) => {
    // 依次访问 8 个页面，dev 按需编译下逐个冷编译，与同文件其他用例一样放宽测试级超时
    test.setTimeout(150_000)
    await seedPersonalOrgSession(page, request)

    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(String(err.message ?? err)))

    // 预热个人组织的 /organization（dev/prod 首次编译均较慢）
    await page.goto('/organization', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500)

    for (const url of [
      '/dashboard',
      '/projects',
      '/projects/new',
      '/search',
      '/settings/profile',
      '/settings/organization',
      '/organization',
    ]) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.waitForTimeout(1200)
    }
    expect(pageErrors).toEqual([])
  })
})
