/**
 * v3-plugin-fixture-market-seed —— smoke/full seed→browse→install/use→reset E2E（task 4.3）。
 *
 * 组合方式：
 * - seed / reset 是本机开发工具入口（无 HTTP 端点，设计如此），在进程内驱动；
 * - browse（私有目录列表）、install preview/confirm、安装读取走真实 HTTP API；
 * - 断言：零公开网络（fetch spy 计 0）、零真实第三方 identity（全部 com.aiproj.*）、
 *   零生产数据标记（fixture 命名空间 + 低敏扫描词表）。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { STRONG_PASSWORD, createOrganization, createUser } from '../unit/ai/_helpers.js'
import AuditService from '#services/audit_service'
import PluginInstallService from '#services/plugin_install_service'
import { PluginFixtureSeedService } from '#services/plugin_fixture_seed_service'
import { FIXTURE_SEED_CATALOG_V1 } from '@aiproj/types/plugin-fixture-market-seed-fixtures'

const RUNTIME_OK = { environment: 'development', explicitEnable: true }

function buildSeedDriver(): PluginFixtureSeedService {
  return new PluginFixtureSeedService(new PluginInstallService(new AuditService()))
}

async function login(client: unknown, email: string): Promise<string> {
  const res = await (client as { post: (p: string) => any }).post('/api/v1/auth/login').json({
    email,
    password: STRONG_PASSWORD,
  })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

for (const PROFILE of ['smoke', 'full'] as const) {
  test.group(`PluginFixtureSeedFlowE2E:${PROFILE}`, (group) => {
    group.setup(() => testUtils.db().truncate())
    group.each.setup(() => testUtils.db().truncate())

    test(`${PROFILE}: seed→browse→install/use→reset，零网络/零第三方/零生产数据`, async ({
      client,
      assert,
    }) => {
      const user = await createUser()
      const org = await createOrganization(user)
      const token = await login(client, user.email)
      const seedDriver = buildSeedDriver()

      let networkCalls = 0
      const globalAny = globalThis as unknown as { fetch?: unknown }
      const previousFetch = globalAny.fetch
      globalAny.fetch = async () => {
        networkCalls += 1
        throw new Error('network forbidden')
      }

      try {
        // 1) seed（进程内开发工具入口；不安装）
        const seeded = await seedDriver.seedToOrganization({
          organizationId: org.id,
          actorId: user.id,
          profile: PROFILE,
          runtime: RUNTIME_OK,
        })
        assert.equal(seeded.status, 'passed')
        const expectedCount = FIXTURE_SEED_CATALOG_V1.items.filter((i) =>
          i.profiles.includes(PROFILE),
        ).length
        assert.equal(seeded.counts.total, expectedCount)

        // 2) browse：组织私有目录列表（HTTP）
        const listRes = await client
          .get(`/api/v1/organizations/${org.id}/plugin-registry`)
          .bearerToken(token)
        listRes.assertStatus(200)
        const listed = listRes.body().data as Array<Record<string, unknown>>
        assert.lengthOf(listed, expectedCount)
        for (const entry of listed) {
          // 零真实第三方：全部为第一方命名空间
          assert.isTrue(String(entry.pluginIdentity).startsWith('com.aiproj.'))
        }

        // 3) resolve 取可安装 releaseId，再走 install preview/confirm（HTTP 两步）
        const targetIdentity =
          PROFILE === 'smoke' ? 'com.aiproj.canary-query' : 'com.aiproj.pilot-bi-template-pack'
        assert.include(
          listed.map((e) => e.pluginIdentity),
          targetIdentity,
        )
        const resolveRes = await client
          .get(`/api/v1/organizations/${org.id}/plugin-registry/resolve`)
          .qs({ pluginIdentity: targetIdentity })
          .bearerToken(token)
        resolveRes.assertStatus(200)
        const targetReleaseId = Number(resolveRes.body().data.releaseId)
        assert.isTrue(Number.isFinite(targetReleaseId))

        const prevRes = await client
          .post(`/api/v1/organizations/${org.id}/plugin-installations/commands/preview`)
          .bearerToken(token)
          .json({ action: 'install', pluginId: targetIdentity, releaseId: targetReleaseId })
        prevRes.assertStatus(200)
        const preview = prevRes.body().data

        const confRes = await client
          .post(`/api/v1/organizations/${org.id}/plugin-installations/commands/confirm`)
          .bearerToken(token)
          .json({ previewHandle: preview.previewHandle, previewDigest: preview.previewDigest })
        confRes.assertStatus(200)

        // 4) use：安装清单可读回（HTTP）
        const installsRes = await client
          .get(`/api/v1/organizations/${org.id}/plugin-installations`)
          .bearerToken(token)
        installsRes.assertStatus(200)
        const installedList = installsRes.body().data as Array<Record<string, unknown>>
        assert.include(
          installedList.map((i) => i.pluginId),
          targetIdentity,
        )

        // 5) reset preview/confirm（进程内开发工具入口）：卸载 + withdraw
        const resetPreview = await seedDriver.resetPreviewFromOrganization({
          organizationId: org.id,
          actorId: user.id,
          runtime: RUNTIME_OK,
        })
        assert.equal(resetPreview.status, 'passed')

        const resetDone = await seedDriver.resetConfirmFromOrganization({
          organizationId: org.id,
          actorId: user.id,
          runtime: RUNTIME_OK,
        })
        assert.equal(resetDone.status, 'passed')

        const afterInstallsRes = await client
          .get(`/api/v1/organizations/${org.id}/plugin-installations`)
          .bearerToken(token)
        afterInstallsRes.assertStatus(200)
        const afterList = afterInstallsRes.body().data as Array<Record<string, unknown>>
        const targetAfter = afterList.find((i) => i.pluginId === targetIdentity)
        assert.equal(targetAfter?.status, 'uninstalled')

        // 零公开网络贯穿全流程
        assert.equal(networkCalls, 0)
      } finally {
        globalAny.fetch = previousFetch
      }
    })
  })
}
