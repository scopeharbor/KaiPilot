import { describe, it, expect, vi } from 'vitest'
import {
  FIXTURE_SEED_ENVIRONMENTS,
  FIXTURE_SEED_FORBIDDEN_MARKET_TERMS,
  computeCanonicalPackageDigest,
  computeFixtureSeedCatalogDigest,
  fixtureSeedStatusToExitCode,
  listFixtureSeedCatalogItemsForProfile,
  normalizeFixtureSeedRunReport,
  parseFixtureSeedCliArgs,
  renderFixtureSeedReportText,
  resolveFixtureSeedEnvironment,
  resolveFixtureSeedProfileGuard,
  runFixtureSeedStatusOrDryRun,
  validateFixtureSeedCatalog,
  type FixtureSeedFileSource,
} from './plugin-fixture-market-seed.js'
import {
  FIXTURE_SEED_CATALOG_V1,
  NEGATIVE_FIXTURE_SEED_CATALOGS,
} from './plugin-fixture-market-seed-fixtures.js'
import { computeDevDigest } from './local-plugin-developer-kit.js'

/** 测试用确定性 sha256 形状哈希（64 hex；仅保证格式与稳定性，非真加密摘要）。 */
function fakeHash(content: string): string {
  const digest = computeDevDigest(content).repeat(8)
  return `sha256:${digest}`
}

function fakeFileSource(files: Record<string, string>): FixtureSeedFileSource {
  return {
    readFile: (_fixtureRoot, relPath) => files[relPath] ?? null,
    hashContent: fakeHash,
  }
}

describe('plugin-fixture-market-seed：profile guard（task 2.3/2.4 契约层）', () => {
  it('production 无论是否显式启用都 fail closed', () => {
    for (const enable of [false, true]) {
      const guard = resolveFixtureSeedProfileGuard({
        environment: 'production',
        explicitEnable: enable,
      })
      expect(guard.allowed).toBe(false)
      if (!guard.allowed) expect(guard.code).toBe('seed-profile-not-allowed')
    }
  })

  it('未知环境 fail closed 且不因字符串变体放行', () => {
    for (const env of ['staging', '', 'PROD', undefined, null, 42]) {
      const guard = resolveFixtureSeedProfileGuard({ environment: env, explicitEnable: true })
      expect(guard.allowed).toBe(false)
      expect(guard.environment === 'unknown' || guard.code === 'seed-profile-not-allowed').toBe(
        true,
      )
    }
    expect(resolveFixtureSeedEnvironment('DEV')).toBe('unknown')
  })

  it('环境名做大小写与空白规范化（demo/Development 均可识别）', () => {
    expect(resolveFixtureSeedEnvironment(' Development ')).toBe('development')
    expect(resolveFixtureSeedEnvironment('DEMO')).toBe('demo')
  })

  it('非生产环境也必须显式启用（默认关闭）', () => {
    for (const env of FIXTURE_SEED_ENVIRONMENTS) {
      if (env === 'production') continue
      const denied = resolveFixtureSeedProfileGuard({ environment: env, explicitEnable: false })
      expect(denied.allowed).toBe(false)
      if (!denied.allowed) expect(denied.code).toBe('seed-explicit-enable-missing')
      const allowed = resolveFixtureSeedProfileGuard({ environment: env, explicitEnable: true })
      expect(allowed.allowed).toBe(true)
    }
  })
})

describe('plugin-fixture-market-seed：catalog checker 正例与确定性（task 1.2）', () => {
  it('真实 catalog 结构校验通过且条目按 itemId 升序', () => {
    const result = validateFixtureSeedCatalog(FIXTURE_SEED_CATALOG_V1)
    expect(result.status).toBe('passed')
    expect(result.findings).toEqual([])
    expect(result.catalog?.items.map((i) => i.itemId)).toEqual(
      [...result.catalog!.items.map((i) => i.itemId)].sort(),
    )
    expect(result.catalogDigest).not.toBe('')
  })

  it('smoke 档位是有界子集且包含最小演示与金丝雀查询', () => {
    const smoke = listFixtureSeedCatalogItemsForProfile(FIXTURE_SEED_CATALOG_V1, 'smoke')
    expect(smoke.map((i) => i.itemId)).toEqual(['canary-query', 'local-dev-demo'])
    const full = listFixtureSeedCatalogItemsForProfile(FIXTURE_SEED_CATALOG_V1, 'full')
    expect(full.length).toBeGreaterThanOrEqual(smoke.length)
  })

  it('catalog 摘要与条目顺序无关（确定性契约）', () => {
    const shuffled = {
      ...FIXTURE_SEED_CATALOG_V1,
      items: [...FIXTURE_SEED_CATALOG_V1.items].reverse(),
    }
    const a = validateFixtureSeedCatalog(FIXTURE_SEED_CATALOG_V1)
    const b = validateFixtureSeedCatalog(shuffled)
    expect(a.status).toBe('passed')
    expect(b.status).toBe('passed')
    expect(a.catalogDigest).toBe(b.catalogDigest)
    expect(b.findings.some((f) => f.code === 'seed-catalog-unsorted-items')).toBe(true)
  })

  it('所有 receipt 都在 fixture-seed 命名空间内且无市场禁词词表遗漏', () => {
    for (const item of FIXTURE_SEED_CATALOG_V1.items) {
      expect(item.upstreamReceiptRef.startsWith('fixture-seed:')).toBe(true)
      const visible = [item.displayName, ...(item.demoTags ?? [])].join(' ')
      for (const term of FIXTURE_SEED_FORBIDDEN_MARKET_TERMS) {
        expect(visible.toLowerCase().includes(term.toLowerCase())).toBe(false)
      }
    }
  })

  it('canonical 包摘要对文件顺序稳定', () => {
    const files = [
      { path: 'b.json', content: '{}' },
      { path: 'a.json', content: '{"x":1}' },
    ]
    const reversed = [...files].reverse()
    expect(computeCanonicalPackageDigest(files, fakeHash)).toBe(
      computeCanonicalPackageDigest(reversed, fakeHash),
    )
  })
})

describe('plugin-fixture-market-seed：checker 负例（task 1.3）', () => {
  for (const [name, negative] of Object.entries(NEGATIVE_FIXTURE_SEED_CATALOGS)) {
    if (name === 'unsortedItems') continue // 排序契约是 warning + 归一化修正，单独断言
    it(`负例 ${name} 被拦截（${negative.expectedCode}）`, () => {
      const result = validateFixtureSeedCatalog(negative.catalog)
      expect(result.status).toBe('blocking')
      expect(result.findings.some((f) => f.code === negative.expectedCode)).toBe(true)
    })
  }

  it('乱序输入给出 warning 且归一化结果与有序输入等价（稳定排序契约）', () => {
    const negative = NEGATIVE_FIXTURE_SEED_CATALOGS['unsortedItems']!
    const result = validateFixtureSeedCatalog(negative.catalog)
    expect(result.status).toBe('passed')
    expect(result.findings.some((f) => f.code === 'seed-catalog-unsorted-items')).toBe(true)
    expect(result.catalog?.items.map((i) => i.itemId)).toEqual(
      [...FIXTURE_SEED_CATALOG_V1.items].map((i) => i.itemId).sort(),
    )
    expect(result.catalogDigest).toBe(computeFixtureSeedCatalogDigest(FIXTURE_SEED_CATALOG_V1))
  })

  it('schema 非对象 → tool-error；缺字段 → tool-error', () => {
    expect(validateFixtureSeedCatalog(null).status).toBe('tool-error')
    expect(validateFixtureSeedCatalog('nope').status).toBe('tool-error')
    expect(validateFixtureSeedCatalog({ schemaVersion: '9.9' }).status).toBe('tool-error')
    expect(
      validateFixtureSeedCatalog({ ...FIXTURE_SEED_CATALOG_V1, schemaVersion: '9.9' }).status,
    ).toBe('tool-error')
  })

  it('缺失 fixture 文件被拦截且不产出可安装结论', () => {
    const item = FIXTURE_SEED_CATALOG_V1.items[0]!
    const result = validateFixtureSeedCatalog(
      { ...FIXTURE_SEED_CATALOG_V1, items: [item] },
      { fileSource: fakeFileSource({}) },
    )
    expect(result.status).toBe('blocking')
    expect(result.findings.some((f) => f.code === 'seed-catalog-fixture-file-missing')).toBe(true)
  })

  it('内容与声明 digest 不一致 → seed-catalog-digest-mismatch（fail closed）', () => {
    const item = FIXTURE_SEED_CATALOG_V1.items.find((i) => i.itemId === 'local-dev-demo')!
    const files: Record<string, string> = {}
    for (const rel of item.entryFiles) {
      files[rel] = '{"tampered":true}'
    }
    const result = validateFixtureSeedCatalog(
      { ...FIXTURE_SEED_CATALOG_V1, items: [item] },
      { fileSource: fakeFileSource(files) },
    )
    expect(result.status).toBe('blocking')
    expect(
      result.findings.filter((f) => f.code === 'seed-catalog-digest-mismatch').length,
    ).toBeGreaterThan(0)
  })

  it('manifest identity 与条目 pluginIdentity 不一致被拦截', () => {
    const item = FIXTURE_SEED_CATALOG_V1.items.find((i) => i.itemId === 'local-dev-demo')!
    const manifestPath = `${item.fixtureRoot}/plugin.manifest.json`
    const files: Record<string, string> = {
      [manifestPath]: JSON.stringify({
        manifestSchemaVersion: '1.0',
        identity: {
          pluginId: 'com.aiproj.other.plugin',
          name: 'x',
          version: '1.0.0',
          publisher: 'p',
        },
        provenance: { distribution: 'first-party' },
        compatibility: { hostContractVersion: '1.0', requiredSeams: [] },
        contributions: [],
        permissions: [],
      }),
    }
    for (const rel of item.entryFiles) {
      if (files[rel] === undefined) files[rel] = '{}'
    }
    // 让 digest 校验先通过，聚焦 identity 不一致
    const withMatchingDigests = {
      ...FIXTURE_SEED_CATALOG_V1,
      items: [
        {
          ...item,
          expectedManifestDigest: fakeHash(files[manifestPath]!),
          expectedPackageDigest: computeCanonicalPackageDigest(
            item.entryFiles.map((rel) => ({ path: rel, content: files[rel]! })),
            fakeHash,
          ),
        },
      ],
    }
    const result = validateFixtureSeedCatalog(withMatchingDigests, {
      fileSource: fakeFileSource(files),
    })
    expect(result.findings.some((f) => f.code === 'seed-catalog-manifest-identity-mismatch')).toBe(
      true,
    )
  })

  it('fixture 文件内容含 Bearer token / 生产数据标记被低敏扫描拦截', () => {
    const item = FIXTURE_SEED_CATALOG_V1.items.find((i) => i.itemId === 'local-dev-demo')!
    const files: Record<string, string> = {}
    let toggle = false
    for (const rel of item.entryFiles) {
      files[rel] = toggle
        ? '{"note":"Bearer abcdefgh123456"}'
        : '{"note":"export from prod-org-42 生产数据"}'
      toggle = !toggle
    }
    const result = validateFixtureSeedCatalog(
      { ...FIXTURE_SEED_CATALOG_V1, items: [{ ...item, itemId: 'scan-me' }] },
      { fileSource: fakeFileSource(files) },
    )
    expect(result.findings.some((f) => f.code === 'seed-catalog-sensitive-content')).toBe(true)
    expect(result.findings.some((f) => f.code === 'seed-catalog-production-marker')).toBe(true)
  })
})

describe('plugin-fixture-market-seed：运行报告与 CLI 解析（task 2.1/2.2 纯函数层）', () => {
  const baseReport = {
    command: 'dry-run' as const,
    profile: 'smoke' as const,
    environment: 'development' as const,
    status: 'passed' as const,
    catalogVersion: FIXTURE_SEED_CATALOG_V1.catalogVersion,
    catalogDigest: 'deadbeef',
    guardAllowed: true,
    items: [
      {
        itemId: 'b-item',
        pluginIdentity: 'com.aiproj.b',
        action: 'validate' as const,
        outcome: 'ok' as const,
      },
      {
        itemId: 'a-item',
        pluginIdentity: 'com.aiproj.a',
        action: 'none' as const,
        outcome: 'already-present' as const,
      },
    ],
  }

  it('报告归一化：items 排序、counts 计算、networkCalls 恒 0、digest 确定', () => {
    const report = normalizeFixtureSeedRunReport(baseReport)
    expect(report.schemaVersion).toBe('1.0')
    expect(report.networkCalls).toBe(0)
    expect(report.trustedAudit).toBe(false)
    expect(report.counts).toEqual({ total: 2, ok: 1, alreadyPresent: 1, failed: 0, skipped: 0 })
    expect(report.items[0]!.itemId).toBe('a-item')
    const shuffled = normalizeFixtureSeedRunReport({
      ...baseReport,
      items: [...baseReport.items].reverse(),
    })
    expect(shuffled.resultDigest).toBe(report.resultDigest)
  })

  it('退出码映射 passed=0 / blocking=1 / tool-error=2', () => {
    expect(fixtureSeedStatusToExitCode('passed')).toBe(0)
    expect(fixtureSeedStatusToExitCode('blocking')).toBe(1)
    expect(fixtureSeedStatusToExitCode('tool-error')).toBe(2)
  })

  it('文本渲染声明 fixture-only/offline/非 production 且不回显 digest', () => {
    const text = renderFixtureSeedReportText(normalizeFixtureSeedRunReport(baseReport))
    expect(text).toContain('本机示例插件库')
    expect(text).toContain('fixture-only')
    expect(text).toContain('非 production')
    expect(text).toContain('网络调用: 0')
    expect(text).not.toContain('sha256:')
  })

  it('CLI 参数解析矩阵', () => {
    expect(parseFixtureSeedCliArgs([]).ok).toBe(false)
    expect(parseFixtureSeedCliArgs(['frobnicate']).ok).toBe(false)
    const ok = parseFixtureSeedCliArgs([
      'dry-run',
      '--profile',
      'full',
      '--format',
      'json',
      '--environment',
      'test',
      '--enable',
    ])
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.invocation.command).toBe('dry-run')
      expect(ok.invocation.profile).toBe('full')
      expect(ok.invocation.format).toBe('json')
      expect(ok.invocation.enable).toBe(true)
    }
    expect(parseFixtureSeedCliArgs(['status', '--bogus']).exitCode).toBe(2)
    expect(parseFixtureSeedCliArgs(['status', '--profile', 'mega']).exitCode).toBe(2)
    expect(parseFixtureSeedCliArgs(['status', 'extra']).exitCode).toBe(2)
  })
})

describe('plugin-fixture-market-seed：CLI 纯运行器（task 2.2）', () => {
  /** 生成条目的自洽合成内容，并返回重算过 digest 的条目与配套文件源。 */
  function syntheticItemWithDigests(
    item: (typeof FIXTURE_SEED_CATALOG_V1)['items'][number],
    overrides?: Record<string, string>,
  ) {
    const files: Record<string, string> = {}
    for (const rel of item.entryFiles) {
      const overridden = overrides?.[rel]
      if (overridden !== undefined) {
        files[rel] = overridden
        continue
      }
      files[rel] = rel.endsWith('plugin.manifest.json')
        ? JSON.stringify({
            manifestSchemaVersion: '1.0',
            identity: {
              pluginId: item.pluginIdentity,
              name: item.displayName,
              version: item.version,
              publisher: 'aiproj-official',
            },
            provenance: { distribution: item.provenance },
            compatibility: {
              hostContractVersion: item.compatibility.hostContractVersion,
              requiredSeams: [...item.compatibility.requiredSeams],
            },
            contributions: [],
            permissions: [],
          })
        : '{}'
    }
    const manifestPath = item.entryFiles.find((f) => f.endsWith('plugin.manifest.json'))!
    const patched = {
      ...item,
      expectedManifestDigest: fakeHash(files[manifestPath]!),
      expectedPackageDigest: computeCanonicalPackageDigest(
        item.entryFiles.map((rel) => ({ path: rel, content: files[rel]! })),
        fakeHash,
      ),
    }
    return { patched, files }
  }

  it('守卫拒绝时 status/dry-run 均 blocking 且不产出条目明细（exit 1）', () => {
    const report = runFixtureSeedStatusOrDryRun({
      invocation: {
        command: 'dry-run',
        profile: 'smoke',
        format: 'text',
        environment: 'production',
        enable: true,
      },
      catalog: FIXTURE_SEED_CATALOG_V1,
    })
    expect(report.status).toBe('blocking')
    expect(report.guardAllowed).toBe(false)
    expect(report.guardCode).toBe('seed-profile-not-allowed')
    expect(report.items).toEqual([])
    expect(fixtureSeedStatusToExitCode(report.status)).toBe(1)

    const noFlag = runFixtureSeedStatusOrDryRun({
      invocation: {
        command: 'status',
        profile: 'smoke',
        format: 'text',
        environment: 'development',
        enable: false,
      },
      catalog: FIXTURE_SEED_CATALOG_V1,
    })
    expect(noFlag.guardCode).toBe('seed-explicit-enable-missing')
    expect(fixtureSeedStatusToExitCode(noFlag.status)).toBe(1)
  })

  it('status 通过守卫后只清点条目且恒 passed；全链路零网络（fetch spy 计数 0）', () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network access is forbidden in fixture seed')
    })
    const globalAny = globalThis as unknown as { fetch?: unknown }
    const previousFetch = globalAny.fetch
    globalAny.fetch = fetchSpy
    try {
      const report = runFixtureSeedStatusOrDryRun({
        invocation: {
          command: 'status',
          profile: 'full',
          format: 'json',
          environment: 'development',
          enable: true,
        },
        catalog: FIXTURE_SEED_CATALOG_V1,
      })
      expect(report.status).toBe('passed')
      expect(report.guardAllowed).toBe(true)
      expect(report.networkCalls).toBe(0)
      expect(report.counts.total).toBe(FIXTURE_SEED_CATALOG_V1.items.length)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      globalAny.fetch = previousFetch
    }
  })

  it('dry-run 对自洽文件源通过（exit 0）', () => {
    const smokeItems = listFixtureSeedCatalogItemsForProfile(FIXTURE_SEED_CATALOG_V1, 'smoke')
    const files: Record<string, string> = {}
    const patchedItems = smokeItems.map((item) => {
      const built = syntheticItemWithDigests(item)
      Object.assign(files, built.files)
      return built.patched
    })
    const report = runFixtureSeedStatusOrDryRun({
      invocation: {
        command: 'dry-run',
        profile: 'smoke',
        format: 'text',
        environment: 'test',
        enable: true,
      },
      catalog: { ...FIXTURE_SEED_CATALOG_V1, items: patchedItems },
      fileSource: fakeFileSource(files),
    })
    expect(report.status).toBe('passed')
    expect(fixtureSeedStatusToExitCode(report.status)).toBe(0)
    expect(report.counts.ok).toBe(smokeItems.length)
  })

  it('dry-run 对 catalog drift（文件被篡改）逐项 fail closed', () => {
    const driftedOriginal = FIXTURE_SEED_CATALOG_V1.items.find(
      (i) => i.itemId === 'local-dev-demo',
    )!
    // 先构造与内容自洽的声明 digest，再篡改磁盘上的一个非 manifest 文件
    const built = syntheticItemWithDigests(driftedOriginal)
    const tamperedTarget = driftedOriginal.entryFiles.find(
      (f) => !f.endsWith('plugin.manifest.json'),
    )!
    built.files[tamperedTarget] = '{"drift":true}'
    const report = runFixtureSeedStatusOrDryRun({
      invocation: {
        command: 'dry-run',
        profile: 'smoke',
        format: 'text',
        environment: 'test',
        enable: true,
      },
      catalog: { ...FIXTURE_SEED_CATALOG_V1, items: [built.patched] },
      fileSource: fakeFileSource(built.files),
    })
    expect(report.status).toBe('blocking')
    expect(
      report.items.some(
        (i) => i.outcome === 'failed' && i.detailCode === 'seed-catalog-digest-mismatch',
      ),
    ).toBe(true)
    expect(fixtureSeedStatusToExitCode(report.status)).toBe(1)
  })

  it('dry-run 对 missing fixture 全部失败并给出稳定 detail code（exit 1）', () => {
    const smokeItems = listFixtureSeedCatalogItemsForProfile(FIXTURE_SEED_CATALOG_V1, 'smoke')
    const report = runFixtureSeedStatusOrDryRun({
      invocation: {
        command: 'dry-run',
        profile: 'smoke',
        format: 'text',
        environment: 'test',
        enable: true,
      },
      catalog: { ...FIXTURE_SEED_CATALOG_V1, items: smokeItems },
      fileSource: fakeFileSource({}),
    })
    expect(report.status).toBe('blocking')
    expect(
      report.items.every(
        (i) => i.outcome === 'failed' && i.detailCode === 'seed-catalog-fixture-file-missing',
      ),
    ).toBe(true)
    expect(fixtureSeedStatusToExitCode(report.status)).toBe(1)
  })
})
