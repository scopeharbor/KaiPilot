/**
 * v2-5-webhook-ip-allowlist —— 具名中间件四态 functional 测试。
 *
 * 本 change 扩展范围：中间件已挂在真实入站接收路由
 * `POST /api/v1/webhooks/:provider`（routes.ts，webhooks.receive）之前。故本测试直接
 * 打这条已挂载路由验证四态，同时证明「挂载生效」。
 *
 * 判定信号：向**未知 provider** POST——过了 IP 门则进入 WebhooksController.receive，
 * 未知 provider 在 kill switch 之前即返回 404 WEBHOOK_PROVIDER_NOT_FOUND（确定信号，
 * 不依赖 WEBHOOKS_INGEST_ENABLED）；被 IP 门拦截则返回 403 WEBHOOK_IP_FORBIDDEN。
 *
 * 四态：
 *   (a) enabled=true 且清单含来源 IP     → 放行（404 WEBHOOK_PROVIDER_NOT_FOUND，非 403）
 *   (b) enabled=true 且清单不含来源 IP   → 403 WEBHOOK_IP_FORBIDDEN
 *   (c) enabled=false                    → 无条件放行（no-op，404）
 *   (d) enabled=true 且清单为空          → 403（fail-closed）
 *
 * 切换四态用 process.env（与 webhook_ingest.spec 切换 WEBHOOKS_INGEST_ENABLED 同法；
 * config/webhook_allowlist.ts 直读 process.env，运行时可切换）。来源 IP 用 request.ip()
 * 在测试下返回的回环地址驱动：允许态用 0.0.0.0/0,::/0（匹配任意 v4/v6 回环），
 * 拒绝态用 203.0.113.0/24（TEST-NET-3，绝不含回环）。禁止新增任何产品路由。
 */
import { test } from '@japa/runner'

const RECEIVE = '/api/v1/webhooks'
// 未知 provider：过 IP 门后必得 404 WEBHOOK_PROVIDER_NOT_FOUND（在 kill switch 之前）。
const UNKNOWN_PROVIDER = '__ip_probe__'
// 匹配任意 IPv4/IPv6 回环，避免依赖 request.ip() 具体返回 127.0.0.1 还是 ::1。
const ALLOW_ANY = '0.0.0.0/0,::/0'
// TEST-NET-3，绝不包含回环，用于确定性拒绝。
const DENY_RANGE = '203.0.113.0/24'

function setAllowlist(enabled: boolean | undefined, cidrs: string | undefined) {
  if (enabled === undefined) delete process.env.WEBHOOK_IP_ALLOWLIST_ENABLED
  else process.env.WEBHOOK_IP_ALLOWLIST_ENABLED = enabled ? 'true' : 'false'
  if (cidrs === undefined) delete process.env.WEBHOOK_IP_ALLOWLIST_CIDRS
  else process.env.WEBHOOK_IP_ALLOWLIST_CIDRS = cidrs
}

function clearAllowlist() {
  delete process.env.WEBHOOK_IP_ALLOWLIST_ENABLED
  delete process.env.WEBHOOK_IP_ALLOWLIST_CIDRS
}

test.group('Webhook IP allowlist middleware — 四态（挂载于真实 receive 路由）', (group) => {
  group.each.teardown(() => {
    clearAllowlist()
  })

  // (a) 开启且清单含来源 IP → 放行（过 IP 门，命中未知 provider 得 404）
  test('开启且命中清单 → 放行到 handler（404 WEBHOOK_PROVIDER_NOT_FOUND，非 403）', async ({
    client,
  }) => {
    setAllowlist(true, ALLOW_ANY)
    const res = await client.post(`${RECEIVE}/${UNKNOWN_PROVIDER}`).json({ ping: 1 })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'WEBHOOK_PROVIDER_NOT_FOUND' } })
  })

  // (b) 开启且清单不含来源 IP → 403 WEBHOOK_IP_FORBIDDEN，handler 不执行
  test('开启但未命中清单 → 403 WEBHOOK_IP_FORBIDDEN', async ({ client }) => {
    setAllowlist(true, DENY_RANGE)
    const res = await client.post(`${RECEIVE}/${UNKNOWN_PROVIDER}`).json({ ping: 1 })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'WEBHOOK_IP_FORBIDDEN' } })
  })

  // (c) 关闭 → 无条件放行（no-op）
  test('关闭 → no-op 放行（404，不返回 403）', async ({ client }) => {
    setAllowlist(false, DENY_RANGE) // 即使清单不含来源 IP，关闭时也应放行
    const res = await client.post(`${RECEIVE}/${UNKNOWN_PROVIDER}`).json({ ping: 1 })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'WEBHOOK_PROVIDER_NOT_FOUND' } })
  })

  // 关闭（未设置任何 env）也应 no-op 放行
  test('未设置开关（默认关闭）→ no-op 放行', async ({ client }) => {
    clearAllowlist()
    const res = await client.post(`${RECEIVE}/${UNKNOWN_PROVIDER}`).json({ ping: 1 })
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'WEBHOOK_PROVIDER_NOT_FOUND' } })
  })

  // (d) 开启但清单为空 → fail-closed 全拒
  test('开启但清单为空 → 403（fail-closed）', async ({ client }) => {
    setAllowlist(true, '') // 空清单
    const res = await client.post(`${RECEIVE}/${UNKNOWN_PROVIDER}`).json({ ping: 1 })
    res.assertStatus(403)
    res.assertBodyContains({ error: { code: 'WEBHOOK_IP_FORBIDDEN' } })
  })
})
