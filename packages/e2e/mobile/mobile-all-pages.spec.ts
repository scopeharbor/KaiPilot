import { test, expect, type Request } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
const inventory: string[] = JSON.parse(
  readFileSync(new URL('./route-inventory.json', import.meta.url), 'utf8'),
)

// Route source inventory is checked for drift; add new pages before declaring complete coverage.
test('全站路由与全部图表手机布局审计', async ({ page, context, request }) => {
  const sourceRoot = resolve('../..', 'apps/frontend/app')
  const currentInventory = readdirSync(sourceRoot, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('/page.tsx') || name === 'page.tsx')
    .map((name) => `apps/frontend/app/${name.replaceAll('\\', '/')}`)
  expect([...inventory].sort()).toEqual(currentInventory.sort())
  await page.goto('/login?next=/next')
  await page
    .getByLabel('邮箱', { exact: true })
    .fill(process.env.E2E_MOBILE_EMAIL || 'admin@aiproj.local')
  await page
    .getByLabel('密码', { exact: true })
    .fill(process.env.E2E_MOBILE_PASSWORD || 'password123')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('[data-role-home]')).toBeVisible()
  const session = await page.evaluate(() => sessionStorage.getItem('aiproj-auth-session')!)
  const headers = { Authorization: `Bearer ${JSON.parse(session).state.accessToken}` }
  const api = process.env.E2E_API_URL || 'http://localhost:3333/api/v1'
  const projects = await request.get(`${api}/projects`, { headers })
  expect(projects.ok()).toBe(true)
  const project = (await projects.json()).data[0]
  const tasks = await request.get(`${api}/projects/${project.id}/tasks`, { headers })
  const task = (await tasks.json()).data[0]
  expect(task).toBeTruthy()
  await context.addInitScript(
    (value) => sessionStorage.setItem('aiproj-auth-session', value),
    session,
  )
  const routes = inventory
    .filter((source) => !source.includes('[chartId]'))
    .map((source) => {
      const pattern =
        source
          .replace('apps/frontend/app', '')
          .replace(/\/\([^/]+\)/g, '')
          .replace('/page.tsx', '') || '/'
      const parameters = [...pattern.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1])
      const missingFixtures = parameters.filter(
        (name) =>
          !['id', 'taskId'].includes(name) || (name === 'id' && !pattern.includes('/projects/')),
      )
      const url = pattern
        .replace(/\[taskId\]/g, String(task.id))
        .replace(/\[id\]/g, pattern.includes('/projects/') ? String(project.id) : '1')
        .replace(/\[[^\]]+\]/g, '1')
      return { source, pattern, url, missingFixtures }
    })
  const metadata = readFileSync(
    resolve('../..', 'apps/frontend/lib/next/charts/chart-catalog-metadata.ts'),
    'utf8',
  )
  for (const match of metadata.matchAll(/    id: '([^']+)'/g))
    routes.push({
      source: 'charts/[chartId]',
      pattern: match[1]!,
      url: `/next/projects/${project.id}/charts/${match[1]}`,
      missingFixtures: [],
    })
  const filter = process.env.E2E_MOBILE_AUDIT_FILTER
  const auditedRoutes = filter
    ? routes.filter((route) => new RegExp(filter).test(route.url))
    : routes
  expect(auditedRoutes.length).toBeGreaterThan(0)
  const results: Record<string, unknown>[] = []
  let index = 0
  const worker = async () => {
    const current = await context.newPage()
    while (index < auditedRoutes.length) {
      const route = auditedRoutes[index++]!
      const errors: string[] = []
      const listener = (error: Error) => errors.push(error.message)
      current.on('pageerror', listener)
      const pending = new Set<Request>()
      const onRequest = (request: Request) => {
        if (request.url().includes('/api/v1/')) pending.add(request)
      }
      const onFinished = (request: Request) => pending.delete(request)
      current.on('request', onRequest)
      current.on('requestfinished', onFinished)
      current.on('requestfailed', onFinished)
      try {
        const response = await current.goto(route.url, { waitUntil: 'domcontentloaded' })
        // Background polling may never become network-idle. Wait for initial data instead.
        await current.waitForTimeout(1500)
        await Promise.race([
          // Error responses may intentionally leave a streamed HTML body unread.
          Promise.all([...pending].map((request) => request.response())),
          current.waitForTimeout(30_000).then(() => {
            throw new Error('页面初始资料请求未完成')
          }),
        ])
        await current.waitForTimeout(250)
        await expect(
          current.locator('[data-project-space-skeleton], [data-chart-space-skeleton]'),
        ).toHaveCount(0)
        const body = await current.locator('body').innerText()
        const width = await current.evaluate(() => document.documentElement.scrollWidth)
        const alerts = await current.getByRole('alert').allTextContents()
        const brokenImages = await current
          .locator('img')
          .evaluateAll((images) =>
            images
              .filter((image) => image.complete && image.naturalWidth === 0)
              .map((image) => image.getAttribute('src')),
          )
        const redirected = new URL(current.url()).pathname !== route.url
        const state = route.missingFixtures.length
          ? '缺少实例资料，仅检查空态/错误态'
          : /没有.*权限|无权|暂无权限/.test(body)
            ? '权限受限'
            : /未启用|尚未启用/.test(body)
              ? '功能旗标关闭'
              : /暂无|没有数据|不存在|未找到/.test(body)
                ? '含空态'
                : '页面已载入'
        const result = {
          ...route,
          state,
          redirected,
          status: response?.status(),
          width,
          alerts,
          errors,
          brokenImages,
        }
        results.push(result)
        if (width > current.viewportSize()!.width + 1 || errors.length)
          await current.screenshot({
            path: test.info().outputPath(`${route.url.replace(/[^a-z0-9]/gi, '_')}.png`),
            fullPage: true,
          })
        expect.soft(width, route.url).toBeLessThanOrEqual(current.viewportSize()!.width + 1)
        expect.soft(errors, route.url).toEqual([])
        expect.soft(brokenImages, `图片：${route.url}`).toEqual([])
        expect
          .soft(
            (await current.locator('main').count()) > 0 ||
              (await current.getByRole('heading').count()) > 0,
            `页面结构：${route.url}`,
          )
          .toBe(true)
      } catch (error) {
        results.push({ ...route, failure: String(error) })
        expect.soft(String(error), route.url).toBe('页面正常载入')
      } finally {
        current.off('pageerror', listener)
        current.off('request', onRequest)
        current.off('requestfinished', onFinished)
        current.off('requestfailed', onFinished)
      }
    }
    await current.close()
  }
  await page.close()
  await Promise.all([worker(), worker(), worker()])
  await test.info().attach('逐页手机审计', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  })
  expect(results).toHaveLength(auditedRoutes.length)
})
