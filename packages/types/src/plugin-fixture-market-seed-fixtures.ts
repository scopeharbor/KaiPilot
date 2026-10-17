/**
 * v3-plugin-fixture-market-seed —— 仓库内确定性 seed catalog 数据与负例样本。
 *
 * - 正例：收录首批已验证 fixtures（tasks 1.4）。每项的 expectedManifestDigest /
 *   expectedPackageDigest 由规范规则离线计算（entryFiles 升序，行格式
 *   `relPath\nsha256(文件字节)\n` 拼接后整体 sha256），fixture 内容漂移会被 checker 拦截。
 * - 负例：仅供测试（路径逃逸/损坏 digest/重复 identity/version/未知依赖/
 *   敏感内容/生产数据标记/市场禁词/乱序），全部为声明式数据，无可执行内容。
 * - 排除项：com.aiproj.official.triz-pack（消费方代码与测试已在仓库清理，见 commit 35fc3be7）、
 *   com.aiproj.official.command-action-pack（并行 change 在途，收口后再录入）。
 */

import type {
  FixtureSeedCatalogItemV1,
  FixtureSeedCatalogV1,
} from './plugin-fixture-market-seed.js'

const RECEIPT = (itemId: string, version: string): string =>
  `fixture-seed:aiproj-local-fixture-plugins/${itemId}@${version}`

const canarySeams = [{ seamKey: 'server-query.readonly-provider', seamVersion: '1.0.0' }] as const
const templateSeams = [{ seamKey: 'template-pack.content-bundle', seamVersion: '1.0.0' }] as const

/** smoke + full 首批目录（items 按 itemId 升序）。 */
export const FIXTURE_SEED_CATALOG_V1: FixtureSeedCatalogV1 = {
  schemaVersion: '1.0',
  kind: 'plugin-fixture-seed-catalog-v1',
  catalogId: 'aiproj-local-fixture-plugins',
  catalogVersion: '1.0.0',
  defaultProfile: 'smoke',
  description:
    '本机示例插件库：非公开、offline、fixture-only 的开发/测试/演示种子目录；不进入 production，不代表开放市场。',
  items: [
    {
      itemId: 'bi-report-official',
      pluginIdentity: 'com.aiproj.official.bi-report-pack',
      displayName: '官方 BI 报表示例包（本机示例）',
      version: '1.0.0',
      provenance: 'first-party',
      fixtureRoot: 'fixtures/plugins/com.aiproj.official.bi-report-pack',
      entryFiles: [
        'fixtures/plugins/com.aiproj.official.bi-report-pack/package.json',
        'fixtures/plugins/com.aiproj.official.bi-report-pack/plugin.manifest.json',
        'fixtures/plugins/com.aiproj.official.bi-report-pack/templates/official-templates.json',
      ],
      expectedManifestDigest:
        'sha256:e80a32a0415b0836730806c9f3ce8ff6f121fc7aa26ec5ef045345870b1755f2',
      expectedPackageDigest:
        'sha256:6c62c7760c82a0698dbf3ba43ae41fd8f4afddbd8110037866da203511f9f76d',
      compatibility: { hostContractVersion: '1.0', requiredSeams: [...templateSeams] },
      upstreamReceiptRef: RECEIPT('bi-report-official', '1.0.0'),
      profiles: ['full'],
      demoTags: ['BI 报表', '模板包'],
      sourceChangeRef: 'official-bi-report-pack',
    },
    {
      itemId: 'canary-advisory',
      pluginIdentity: 'com.aiproj.canary-advisory',
      displayName: '金丝雀建议示例（本机示例）',
      version: '1.0.0',
      provenance: 'first-party',
      fixtureRoot: 'fixtures/plugins/com.aiproj.canary-advisory',
      entryFiles: [
        'fixtures/plugins/com.aiproj.canary-advisory/canary/skill-bundle.json',
        'fixtures/plugins/com.aiproj.canary-advisory/package.json',
        'fixtures/plugins/com.aiproj.canary-advisory/plugin.manifest.json',
      ],
      expectedManifestDigest:
        'sha256:8e515a5df452c698d60f2a7fb66959cac04cdf169c227787b00488f3ffb34357',
      expectedPackageDigest:
        'sha256:bcda5c9eb55d054f16faa46f21452c967a14ab13c6f9c50b91142664cc20e9c2',
      compatibility: { hostContractVersion: '1.0', requiredSeams: [...canarySeams] },
      upstreamReceiptRef: RECEIPT('canary-advisory', '1.0.0'),
      profiles: ['full'],
      demoTags: ['只读建议', '金丝雀'],
      sourceChangeRef: 'v3-first-party-plugin-canary-pack',
    },
    {
      itemId: 'canary-query',
      pluginIdentity: 'com.aiproj.canary-query',
      displayName: '金丝雀只读查询示例（本机示例）',
      version: '1.0.0',
      provenance: 'first-party',
      fixtureRoot: 'fixtures/plugins/com.aiproj.canary-query',
      entryFiles: [
        'fixtures/plugins/com.aiproj.canary-query/canary/query-summary.json',
        'fixtures/plugins/com.aiproj.canary-query/package.json',
        'fixtures/plugins/com.aiproj.canary-query/plugin.manifest.json',
      ],
      expectedManifestDigest:
        'sha256:b3b5195156d54aee98c82e5cc063afe68e75e8c39687b15c85e92235a5903fb3',
      expectedPackageDigest:
        'sha256:70b5610c1c5c1030989341c6d039989816ddb938bec8ab888e9a7c5008267af0',
      compatibility: { hostContractVersion: '1.0', requiredSeams: [...canarySeams] },
      upstreamReceiptRef: RECEIPT('canary-query', '1.0.0'),
      profiles: ['smoke', 'full'],
      demoTags: ['只读查询', '金丝雀'],
      sourceChangeRef: 'v3-first-party-plugin-canary-pack',
    },
    {
      itemId: 'local-dev-demo',
      pluginIdentity: 'com.aiproj.example.local-dev-demo',
      displayName: '本地开发演示插件（本机示例）',
      version: '1.0.0',
      provenance: 'fixture',
      fixtureRoot: 'fixtures/plugins/com.aiproj.example.local-dev-demo',
      entryFiles: [
        'fixtures/plugins/com.aiproj.example.local-dev-demo/host-profile.install.json',
        'fixtures/plugins/com.aiproj.example.local-dev-demo/package.json',
        'fixtures/plugins/com.aiproj.example.local-dev-demo/plugin.manifest.json',
      ],
      expectedManifestDigest:
        'sha256:e9c93d96f7dfdc1c4e423d9a33d3aeb91a6ad8e91ded2490355620de86f30527',
      expectedPackageDigest:
        'sha256:7158458f35429687dfda560ebc444dee4ea98feb754c6178030f2ef3a5aaadf7',
      compatibility: { hostContractVersion: '1.0', requiredSeams: [] },
      upstreamReceiptRef: RECEIPT('local-dev-demo', '1.0.0'),
      profiles: ['smoke', 'full'],
      demoTags: ['最小演示'],
      sourceChangeRef: 'v3-local-plugin-developer-kit',
    },
    {
      itemId: 'ocr-profile-pack',
      pluginIdentity: 'com.aiproj.official.ocr-profile-pack',
      displayName: 'OCR 抽取配置示例包（本机示例）',
      version: '1.0.0',
      provenance: 'first-party',
      fixtureRoot: 'fixtures/plugins/com.aiproj.official.ocr-profile-pack',
      entryFiles: [
        'fixtures/plugins/com.aiproj.official.ocr-profile-pack/ocr-profiles.json',
        'fixtures/plugins/com.aiproj.official.ocr-profile-pack/package.json',
        'fixtures/plugins/com.aiproj.official.ocr-profile-pack/plugin.manifest.json',
      ],
      expectedManifestDigest:
        'sha256:e01011b94d36d3c09a148ad7851772bd778f5c2a638bc949c1b154e6dc537859',
      expectedPackageDigest:
        'sha256:bdb597c59f12fccee73001542f0001cda124f4e1ec22398ad0702f4bb7eff1e4',
      compatibility: {
        hostContractVersion: '1.0',
        requiredSeams: [{ seamKey: 'ocr-profile.content-bundle', seamVersion: '1.0.0' }],
      },
      upstreamReceiptRef: RECEIPT('ocr-profile-pack', '1.0.0'),
      profiles: ['full'],
      demoTags: ['OCR 配置', '声明式'],
      sourceChangeRef: 'v3-ocr-profile-plugin-pack',
    },
    {
      itemId: 'pilot-bi-template-pack',
      pluginIdentity: 'com.aiproj.pilot-bi-template-pack',
      displayName: 'BI 模板试点示例包（本机示例）',
      version: '1.0.0',
      provenance: 'first-party',
      fixtureRoot: 'fixtures/plugins/com.aiproj.pilot-bi-template-pack',
      entryFiles: [
        'fixtures/plugins/com.aiproj.pilot-bi-template-pack/package.json',
        'fixtures/plugins/com.aiproj.pilot-bi-template-pack/plugin.manifest.json',
        'fixtures/plugins/com.aiproj.pilot-bi-template-pack/templates/pilot-templates.json',
      ],
      expectedManifestDigest:
        'sha256:8665fd80ae35e53f4fb5152a4640033d0ce126443c76391b84e146d229f32311',
      expectedPackageDigest:
        'sha256:ed785bb1fa5f89927f39829d97a53b8a53e8e88d1e8ff9ba4025390a64fcb149',
      compatibility: { hostContractVersion: '1.0', requiredSeams: [...templateSeams] },
      upstreamReceiptRef: RECEIPT('pilot-bi-template-pack', '1.0.0'),
      profiles: ['full'],
      demoTags: ['BI 报表', '试点'],
      sourceChangeRef: 'v3-template-as-plugin-package',
    },
  ],
}

// =============================================================================
// 负例样本（仅测试用；全部声明式）
// =============================================================================

const baseValidItem: FixtureSeedCatalogItemV1 = FIXTURE_SEED_CATALOG_V1.items.find(
  (item) => item.itemId === 'local-dev-demo',
) as FixtureSeedCatalogItemV1

function cloneCatalogWith(
  mutate: (catalog: FixtureSeedCatalogV1) => FixtureSeedCatalogV1,
): FixtureSeedCatalogV1 {
  return mutate(FIXTURE_SEED_CATALOG_V1)
}

/** 负例目录集：key → 预期命中的 finding code。 */
export const NEGATIVE_FIXTURE_SEED_CATALOGS: Readonly<
  Record<string, { readonly catalog: unknown; readonly expectedCode: string }>
> = {
  pathEscape: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [
        {
          ...baseValidItem,
          itemId: 'escape-root',
          fixtureRoot: '../outside/secrets',
          entryFiles: ['../outside/secrets/plugin.manifest.json'],
        },
      ],
    })),
    expectedCode: 'seed-catalog-path-escape',
  },
  digestFormatInvalid: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [{ ...baseValidItem, itemId: 'bad-digest-format', expectedManifestDigest: 'md5:abc' }],
    })),
    expectedCode: 'seed-catalog-digest-format-invalid',
  },
  duplicateItemId: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [baseValidItem, { ...baseValidItem, version: '1.0.1' }],
    })),
    expectedCode: 'seed-catalog-duplicate-item-id',
  },
  duplicateIdentityVersion: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [baseValidItem, { ...baseValidItem, itemId: 'local-dev-demo-copy' }],
    })),
    expectedCode: 'seed-catalog-duplicate-identity-version',
  },
  unknownDependency: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [{ ...baseValidItem, itemId: 'needs-ghost', dependsOn: ['ghost-item'] }],
    })),
    expectedCode: 'seed-catalog-unknown-dependency',
  },
  dependencyCycle: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [
        { ...baseValidItem, itemId: 'cycle-a', dependsOn: ['cycle-b'] },
        { ...baseValidItem, itemId: 'cycle-b', dependsOn: ['cycle-a'] },
      ],
    })),
    expectedCode: 'seed-catalog-dependency-cycle',
  },
  sensitiveContent: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [
        {
          ...baseValidItem,
          itemId: 'leaky-item',
          upstreamReceiptRef: 'fixture-seed:demo-token-value-here',
          demoTags: ['api_key="supersecret123"'],
        },
      ],
    })),
    expectedCode: 'seed-catalog-sensitive-content',
  },
  marketWording: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [
        { ...baseValidItem, itemId: 'market-wording', displayName: '插件市场精选入驻（违规命名）' },
      ],
    })),
    expectedCode: 'seed-catalog-market-wording-forbidden',
  },
  descriptionMarkerMissing: {
    catalog: cloneCatalogWith((catalog) => ({ ...catalog, description: '一个很棒的目录' })),
    expectedCode: 'seed-catalog-description-marker-missing',
  },
  unsortedItems: {
    catalog: cloneCatalogWith((catalog) => ({
      ...catalog,
      items: [...catalog.items].reverse(),
    })),
    expectedCode: 'seed-catalog-unsorted-items',
  },
}
