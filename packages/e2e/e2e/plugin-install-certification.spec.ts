import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import { API_BASE, loginAsAdmin, setAuthSession } from './_auth-helper'

/**
 * v3-plugin-e2e-lifecycle-certification —— 浏览器人机边界认证（W5c 任务 3.1~3.3）。
 *
 * 被测面：/dev/plugin-install-harness 沙箱页（挂载既有 PluginInstallList /
 * PluginInstallConfirmDialog），全部状态转移走真实后端 preview/confirm。
 *
 * - 3.1 安装权限 diff、人工确认、禁用/卸载入口；取消确认与 stale confirmation。
 * - 3.2 advisory canary 仅建议边界：启用必须显式勾选权限确认；全程零外部网络、
 *   零正式数据写入端点（请求级断言，配合后端套件 providerCalls=0 契约锚点）。
 * - 3.3 健康/兼容错误的可访问性展示：稳定错误码可读、原始 metadata 不外泄。
 *
 * 幂等：global-setup 的 e2e_plugin_canary_seeder 会重置 uninstalled 死行；
 * 已存在 installed/enabled 行时测试自适应（先经 API 归位到目标前置态）。
 */

const QUERY_PLUGIN = 'com.aiproj.canary-query'
const ADVISORY_PLUGIN = 'com.aiproj.canary-advisory'

// 全程收集请求：认证运行期间不得出现任何非本机后端的网络调用（零 provider 外发）
let externalRequests: string[] = []

/**
 * 直连 API 调用的 bearer token。
 *
 * `APIRequestContext` 不会因为登录过一次就自动带上凭据（后端是 JWT，不是 cookie 会话），
 * 每个请求都必须显式带 Authorization，否则一律 401 `AUTH_REQUIRED`。
 */
let accessToken = ''

function authHeaders(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}

async function apiPost(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<{ status: number; body: any }> {
  const res = await request.post(API_BASE + path, { data, headers: authHeaders() })
  let body: any = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status(), body }
}

/** 经真实 API 驱动两步命令（preview → confirm），enable 自动携带权限确认。 */
async function driveCommand(
  request: APIRequestContext,
  orgId: number,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; installation: any; errorCode?: string }> {
  const preview = await apiPost(
    request,
    `/organizations/${orgId}/plugin-installations/commands/preview`,
    payload,
  )
  if (preview.status !== 200) {
    return { ok: false, installation: null, errorCode: preview.body?.error?.code ?? 'unknown' }
  }
  const p = preview.body.data
  const confirm = await apiPost(
    request,
    `/organizations/${orgId}/plugin-installations/commands/confirm`,
    {
      previewHandle: p.previewHandle,
      previewDigest: p.previewDigest,
      ...(payload.action === 'enable'
        ? { permissionConfirmed: true, permissionDigest: p.permissionDigest }
        : {}),
    },
  )
  if (confirm.status !== 200) {
    return { ok: false, installation: null, errorCode: confirm.body?.error?.code ?? 'unknown' }
  }
  return { ok: true, installation: confirm.body.data }
}

/**
 * 取组织目录中某插件某版本的 approved release 主键。
 *
 * `install` / `upgrade` 的 releaseId 是必填：宿主不做「猜一个版本」的隐式选择，
 * 缺了就以 `plugin-install-payload-invalid` fail-closed。
 */
async function findApprovedReleaseId(
  request: APIRequestContext,
  organizationId: number,
  pluginIdentity: string,
  version: string,
): Promise<number> {
  const res = await request.get(
    `${API_BASE}/organizations/${organizationId}/plugin-directory/releases?status=approved&perPage=50`,
    { headers: authHeaders() },
  )
  const body = await res.json()
  const match = (body?.data ?? []).find(
    (item: { pluginIdentity: string; version: string }) =>
      item.pluginIdentity === pluginIdentity && item.version === version,
  )
  if (!match) throw new Error(`approved release not found: ${pluginIdentity}@${version}`)
  return Number(match.releaseId)
}

type QueryState = 'absent' | 'installed' | 'enabled' | 'uninstalled'

async function getQueryInstallation(
  request: APIRequestContext,
  orgId: number,
): Promise<{ state: QueryState; id?: number }> {
  const res = await request.get(
    `${API_BASE}/organizations/${orgId}/plugin-installations/${QUERY_PLUGIN}`,
    { headers: authHeaders() },
  )
  if (res.status() !== 200) return { state: 'absent' }
  const body = await res.json()
  const status = body?.data?.status as QueryState | undefined
  if (!status || status === 'uninstalled')
    return { state: status === 'uninstalled' ? 'uninstalled' : 'absent' }
  return { state: status, id: body.data.id }
}

test.describe('插件生命周期浏览器认证（v3-plugin-e2e-lifecycle-certification）', () => {
  let orgId = 0

  test.beforeEach(async ({ page, request }) => {
    const auth = await loginAsAdmin(request)
    orgId = auth.currentOrganizationId
    accessToken = auth.accessToken
    externalRequests = []
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        externalRequests.push(req.url())
      }
    })
    await page.goto('/')
    await setAuthSession(page, auth)
    await page.goto('/dev/plugin-install-harness')
    await expect(page.locator('[data-plugin-harness]')).toBeVisible({ timeout: 15000 })
  })

  test('3.1 安装权限 diff 与人工确认门：未勾选不可提交，勾选后启用成功', async ({
    page,
    request,
  }) => {
    // 前置归位：enabled → 先停用；uninstalled 由种子器重置为 absent
    const current = await getQueryInstallation(request, orgId)
    if (current.state === 'enabled') {
      await driveCommand(request, orgId, { action: 'disable', pluginId: QUERY_PLUGIN })
    } else if (current.state === 'absent') {
      const releaseId = await findApprovedReleaseId(request, orgId, QUERY_PLUGIN, '1.0.0')
      const installed = await driveCommand(request, orgId, {
        action: 'install',
        pluginId: QUERY_PLUGIN,
        releaseId,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`seed install failed: ${r.errorCode}`)
        return r.installation
      })
      void installed
    }

    await page.reload()
    await expect(page.locator(`[data-install-card="${QUERY_PLUGIN}"]`)).toBeVisible()

    // 打开启用对话框：必须展示状态转移 + 权限清单 diff + 贡献影响面
    await page.click('[data-action-enable]')
    const dialog = page.locator('[data-plugin-install-dialog]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(page.locator('[data-permission-item]').first()).toBeVisible({ timeout: 10000 })

    // 权限确认门：未勾选时确认按钮禁用（人工确认不可绕过）
    await expect(page.locator('[data-permission-confirm-box]')).toBeVisible()
    await expect(page.locator('[data-confirm-button]')).toBeDisabled()
    await page.check('[data-permission-checkbox]')
    await expect(page.locator('[data-confirm-button]')).toBeEnabled()

    // 确认后对话框关闭且列表刷新为已启用
    await page.click('[data-confirm-button]')
    await expect(dialog).not.toBeVisible({ timeout: 10000 })
    await expect(
      page.locator(`[data-install-card="${QUERY_PLUGIN}"]`).locator('text=已启用'),
    ).toBeVisible({ timeout: 10000 })
  })

  test('3.1 取消确认不改变状态；stale confirmation 提交被拒并展示可读错误', async ({
    page,
    request,
  }) => {
    // 前置归位到 enabled
    const current = await getQueryInstallation(request, orgId)
    if (current.state === 'absent' || current.state === 'uninstalled') {
      test.skip()
      return
    }
    if (current.state === 'installed') {
      const enabled = await driveCommand(request, orgId, {
        action: 'enable',
        pluginId: QUERY_PLUGIN,
      })
      if (!enabled.ok) throw new Error(`seed enable failed: ${enabled.errorCode}`)
      await page.reload()
    }

    // ── 取消确认：打开停用对话框后取消，状态保持 enabled ──
    await page.click('[data-action-disable]')
    const dialog = page.locator('[data-plugin-install-dialog]')
    await expect(page.locator('[data-confirm-button]')).toBeEnabled({ timeout: 10000 })
    await page.click('[data-cancel-button]')
    await expect(dialog).not.toBeVisible()
    await expect(
      page.locator(`[data-install-card="${QUERY_PLUGIN}"]`).locator('text=已启用'),
    ).toBeVisible()

    // ── stale confirmation：对话框持有的 preview 句柄被并发消费后提交 → 后端拒绝 ──
    const previewPromise = page.waitForResponse(
      (r) => r.url().includes('/commands/preview') && r.request().method() === 'POST',
    )
    await page.click('[data-action-disable]')
    const stalePreviewResp = await previewPromise
    const stalePreview = (await stalePreviewResp.json()).data
    // 并发消费同一句柄（模拟另一窗口已完成停用确认）
    const consumed = await apiPost(
      request,
      `/organizations/${orgId}/plugin-installations/commands/confirm`,
      { previewHandle: stalePreview.previewHandle, previewDigest: stalePreview.previewDigest },
    )
    expect(consumed.status).toBe(200)
    // UI 再提交同一句柄 → 后端 400，对话框展示低敏错误而非崩溃或静默成功
    await page.click('[data-confirm-button]')
    await expect(page.locator('[data-dialog-error]')).toBeVisible({ timeout: 10000 })
    // 关闭对话框刷新后卡片反映真实状态（已停用为 installed，可再次启用——不用不可逆终态）
    await page.click('[data-cancel-button]')
    // 并发停用发生在另一条通道，本页列表仍是旧快照；显式刷新后必须落到真实状态
    await page.reload()
    await expect(
      page.locator(`[data-install-card="${QUERY_PLUGIN}"]`).locator('text=已安装'),
    ).toBeVisible({ timeout: 10000 })
  })

  test('3.2 advisory canary 仅建议边界：安装/启用走人工确认且零外部网络零正式写入', async ({
    page,
    request,
  }) => {
    // 记录全部写类 API 端点，收尾断言不含任何 AI/正式业务写入路径
    const writePaths: string[] = []
    page.on('request', (req) => {
      const method = req.method().toUpperCase()
      const url = req.url()
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && url.includes('/api/v1/')) {
        writePaths.push(url.replace(/\?.*$/, ''))
      }
    })

    // advisory 若已在 enabled 态则先停用+跳过重复安装；absent 则经目录 UI 完整安装
    const advisoryRes = await request.get(
      `${API_BASE}/organizations/${orgId}/plugin-installations/${ADVISORY_PLUGIN}`,
      { headers: authHeaders() },
    )
    const advisoryState =
      advisoryRes.status() === 200 ? (await advisoryRes.json())?.data?.status : 'absent'

    if (advisoryState === 'absent' || advisoryState === 'uninstalled') {
      await page.selectOption(
        '[data-directory-select]',
        { label: `${ADVISORY_PLUGIN}@1.0.0` },
        { timeout: 10000 },
      )
      await page.click('[data-install-selected]')
      const installDialog = page.locator('[data-plugin-install-dialog]')
      await expect(installDialog).toBeVisible()
      // 安装（只读声明）无需权限勾选，但仍是显式二次确认
      await expect(page.locator('[data-contribution-item]').first()).toBeVisible({
        timeout: 10000,
      })
      await page.click('[data-confirm-button]')
      await expect(installDialog).not.toBeVisible({ timeout: 10000 })
    }

    // 启用 advisory：权限勾选门（仅建议也必须人工确认授权边界）
    await page.reload()
    await expect(page.locator(`[data-install-card="${ADVISORY_PLUGIN}"]`)).toBeVisible()
    const cardText = await page.locator(`[data-install-card="${ADVISORY_PLUGIN}"]`).innerText()
    if (!cardText.includes('已启用')) {
      await page.click(`[data-install-card="${ADVISORY_PLUGIN}"] [data-action-enable]`)
      await expect(page.locator('[data-permission-confirm-box]')).toBeVisible()
      await page.check('[data-permission-checkbox]')
      await page.click('[data-confirm-button]')
      await expect(page.locator('[data-plugin-install-dialog]')).not.toBeVisible({
        timeout: 10000,
      })
    }

    // 收尾断言：
    // - 零外部网络（provider 调用为零的外部可见面）
    expect(externalRequests).toEqual([])
    // - 写端点白名单：只允许插件安装命令通道（AI 建议/正式业务写入端点一律未触发）
    const forbidden = writePaths.filter(
      (u) =>
        !u.includes('/plugin-installations/commands/') &&
        !u.includes('/auth/login') &&
        !u.includes('/auth/refresh'),
    )
    expect(forbidden).toEqual([])
  })

  test('3.3 兼容性错误以稳定错误码可读呈现且不泄露原始 manifest 细节', async ({ page }) => {
    // 选择破坏性版本 9.9.9（hostRange >=99）→ 目录安装预览必须失败
    await page.selectOption(
      '[data-directory-select]',
      { label: `${QUERY_PLUGIN}@9.9.9` },
      { timeout: 10000 },
    )
    await page.click('[data-install-selected]')

    // 错误以稳定 code 展示（可读、可定位），不出现 hostRange/manifest 原文字段
    const errBanner = page.locator('[data-error-code]')
    await expect(errBanner).toBeVisible({ timeout: 10000 })
    await expect(errBanner).toContainText('plugin-install-source-incompatible')
    const bannerText = await errBanner.innerText()
    expect(bannerText).not.toContain('99.0.0')
    expect(bannerText).not.toContain('hostRange')

    // 对话框不应在预览失败时伪造成功内容
    await expect(page.locator('[data-plugin-install-dialog]')).toHaveCount(0)

    // 页面整体保持可用（a11y 基线：alert 角色可达）
    expect(await page.locator('[role="alert"]').count()).toBeGreaterThanOrEqual(1)
  })

  test.afterEach(async () => {
    // 全局零外发红线：任何用例出现非本机请求即失败
    expect(externalRequests).toEqual([])
  })
})
