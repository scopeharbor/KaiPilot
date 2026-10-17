/**
 * plugin-capability-seam-catalog-curated —— 首批 curated catalog 测试（tasks 3.2/3.4/3.6/3.7）。
 *
 * 覆盖：required family 全覆盖与 identity 唯一、Skill/Compiler 复用既有契约边界
 * （不复制 Skill identity/lifecycle/ActivationRule/resolveActivation，不把 delivered Skill
 * 底座自动提升为通用插件 host-ready）、领域边界（query/UI 非权威、transformer 不绕 validator、
 * command 只产 proposal/preview、notification 无授权不外发、report/export 核心控权）、
 * deliveryStatus 与 Observation inventory 一致性。
 */
import { describe, expect, it } from 'vitest'
import { REQUIRED_PLUGIN_SEAM_FAMILIES, SEAM_RULE_IDS } from './plugin-capability-seam-catalog.js'
import {
  PLUGIN_SEAM_CURATED_CATALOG,
  SEAM_KNOWN_CONTRACT_REFS,
  SEAM_KNOWN_OWNER_REFS,
  curatedSeamFamilies,
} from './plugin-capability-seam-catalog-curated.js'
import { evaluateSeamCatalog, validateSeamCatalog } from './plugin-capability-seam-catalog.js'
import { makeSeamSkillAdapterNegativeFixture } from './plugin-capability-seam-catalog-fixtures.js'

// =============================================================================
// 3.2 coverage / identity
// =============================================================================

describe('curated catalog coverage 与 identity（3.2）', () => {
  it('目录整体校验：零 blocking / 零 warning（curated entries 全合法）', () => {
    const result = validateSeamCatalog([...PLUGIN_SEAM_CURATED_CATALOG], {
      knownContractRefs: SEAM_KNOWN_CONTRACT_REFS,
      knownOwnerRefs: SEAM_KNOWN_OWNER_REFS,
    })
    expect(result.blockingCount).toBe(0)
    expect(result.warningCount).toBe(0)
  })

  it('每个 required family 至少一个独立 entry（REQUIRED_PLUGIN_SEAM_FAMILIES 全覆盖）', () => {
    for (const family of REQUIRED_PLUGIN_SEAM_FAMILIES) {
      const entries = PLUGIN_SEAM_CURATED_CATALOG.filter((e) => e.surface === family)
      expect(entries.length, `family ${family} 缺条目`).toBeGreaterThanOrEqual(1)
    }
    const families = curatedSeamFamilies()
    for (const family of REQUIRED_PLUGIN_SEAM_FAMILIES) {
      expect(families[family]!.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('seamKey + seamVersion 全局唯一', () => {
    const ids = PLUGIN_SEAM_CURATED_CATALOG.map((e) => `${e.seamKey}@${e.seamVersion}`)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('一个条目不得捆绑多个高风险 host：每个 entry 只挂一个 surface，且不含公开市场/计费/任意代码执行 family', () => {
    for (const entry of PLUGIN_SEAM_CURATED_CATALOG) {
      expect(entry.surface).toBeDefined()
    }
    const forbidden = ['marketplace', 'billing', 'arbitrary-code', 'remote-code', 'public-publish']
    for (const family of REQUIRED_PLUGIN_SEAM_FAMILIES) {
      expect(forbidden.some((f) => family.includes(f))).toBe(false)
    }
  })

  it('family gap 检测：缺任一 required family → blocking（evaluateSeamCatalog）', () => {
    const withoutUi = PLUGIN_SEAM_CURATED_CATALOG.filter((e) => e.surface !== 'ui-slot')
    const result = evaluateSeamCatalog([...withoutUi])
    expect(result.blockingCount).toBeGreaterThanOrEqual(1)
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.requiredFamilyGap)).toBe(true)
  })
})

// =============================================================================
// 3.4 Skill / Compiler 复用边界
// =============================================================================

describe('Skill/Compiler 接缝复用既有领域契约（3.4）', () => {
  it('skill-adapter 条目引用既有 registry/activation 契约，不复制 Skill identity/lifecycle', () => {
    const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'skill-adapter')!
    expect(entry.contractRefs).toContain('compiler-skill-registry')
    expect(entry.contractRefs).toContain('skill-activation-rules-engine')
    expect(entry.contractRefs).toContain('compiler-skill-injection')
    // 既有底座是 delivered 但 adapter host 未交付 → 必须保持 cataloged
    expect(entry.deliveryStatus).toBe('incremental-gap')
    expect(entry.availability).toBe('cataloged')
  })

  it('compiler-contribution 保留 Compiler 不变量核心归属', () => {
    const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'compiler-contribution')!
    expect(entry.compilerInvariantOwnership).toBe('core')
    expect(entry.operationModes).toContain('advisory')
    expect(entry.availability).toBe('cataloged')
  })

  it('不得把 delivered Skill 底座自动提升为通用插件 host-ready（负例 → blocking）', () => {
    const negative = makeSeamSkillAdapterNegativeFixture()
    const result = validateSeamCatalog([negative])
    expect(result.blockingCount).toBeGreaterThanOrEqual(1)
    expect(result.findings.some((f) => f.ruleId === SEAM_RULE_IDS.hostReadyNoEvidence)).toBe(true)
  })

  it('不得创建第二套 Skill Registry：skill-adapter seam 只引用既有 registry/lifecycle 契约', () => {
    const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'skill-adapter')!
    expect(entry.contractRefs.every((ref) => SEAM_KNOWN_CONTRACT_REFS.includes(ref))).toBe(true)
    // 不存在复制型的 contract（第二套 registry / 自研 activation engine）
    expect(
      entry.contractRefs.some(
        (ref) => ref.startsWith('plugin-own-skill-') || ref.includes('second-registry'),
      ),
    ).toBe(false)
  })
})

// =============================================================================
// 3.6 领域边界
// =============================================================================

describe('服务/数据/UI/报告/通知领域边界（3.6）', () => {
  it('server-query 与 ui-slot 非权威（不得覆盖正式项目/任务/风险/权限事实）', () => {
    for (const surface of ['server-query', 'ui-slot'] as const) {
      const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === surface)!
      expect(['non-authoritative-read', 'non-authoritative-render']).toContain(entry.dataOwnership)
    }
  })

  it('data-transformer 不绕 validator：非 core-authoritative 且失败模式 block-extension', () => {
    const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'data-transformer')!
    expect(entry.dataOwnership).not.toBe('core-authoritative')
    expect(entry.failureMode).toBe('block-extension')
  })

  it('server-command-proposal 只产 proposal/preview：sideEffectClass=proposal 且确认 host-brokered', () => {
    const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'server-command-proposal')!
    expect(entry.sideEffectClass).toBe('proposal')
    expect(['host-brokered', 'required']).toContain(entry.confirmationPolicy)
    expect(['proposal', 'preview']).toContain(entry.operationModes[0])
  })

  it('notification-template 无授权不外发：networkPolicy 只允许 fixture-mock/无直连', () => {
    const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'notification-template')!
    expect(['none', 'fixture-mock-only', 'host-brokered']).toContain(entry.networkPolicy)
    expect(entry.networkPolicy).not.toBe('direct-allowed')
    expect(entry.sideEffectClass).not.toBe('external-action')
  })

  it('report-renderer 导出权限与证据仍由核心控制：只渲染、非权威', () => {
    const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'report-renderer')!
    expect(entry.operationModes).toEqual(['render'])
    expect(entry.dataOwnership).not.toBe('core-authoritative')
    expect(entry.failureMode).not.toBe('fail-open')
  })

  it('template-pack 模板包接缝：只读非权威、零网络、零外部动作、归属 reporting-core', () => {
    const entry = PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'template-pack')!
    expect(entry).toBeDefined()
    expect(entry.seamKey).toBe('template-pack.content-bundle')
    expect(entry.classification).toBe('plugin')
    expect(entry.deliveryStatus).toBe('net-new')
    expect(entry.ownerRef).toBe('reporting-core')
    expect(entry.contractRefs).toContain('bi-report-template-library')
    expect(entry.operationModes).toEqual(['read-only'])
    expect(entry.sideEffectClass).toBe('read-only')
    expect(entry.confirmationPolicy).toBe('not-required')
    expect(entry.networkPolicy).toBe('none')
    expect(entry.dataOwnership).toBe('non-authoritative-read')
    expect(entry.failureMode).toBe('isolate-drop')
    expect(entry.scopeModes).toEqual(['organization'])
    expect(entry.requiredPermissions).toEqual(['report:view'])
  })

  it('领域边界违反负例：transformer 声明 core-authoritative → blocking', () => {
    const entry = {
      ...PLUGIN_SEAM_CURATED_CATALOG.find((e) => e.surface === 'data-transformer')!,
      dataOwnership: 'core-authoritative',
    }
    const result = validateSeamCatalog([entry])
    expect(result.blockingCount).toBeGreaterThanOrEqual(1)
  })
})

// =============================================================================
// 3.7 deliveryStatus 与 Observation inventory 一致性
// =============================================================================

describe('curated deliveryStatus 与 inventory 一致性（3.7）', () => {
  it('Skill/Compiler family 为 incremental-gap；其余必为 net-new/conditional/deferred（无 delivered）', () => {
    for (const entry of PLUGIN_SEAM_CURATED_CATALOG) {
      if (entry.surface === 'skill-adapter' || entry.surface === 'compiler-contribution') {
        expect(entry.deliveryStatus).toBe('incremental-gap')
      } else {
        expect(['net-new', 'conditional', 'deferred']).toContain(entry.deliveryStatus)
      }
    }
  })

  it('PRD-only/planning-only 表面不得 delivered；所有条目 availability=cataloged（无 host 证据）', () => {
    for (const entry of PLUGIN_SEAM_CURATED_CATALOG) {
      expect(entry.deliveryStatus).not.toBe('delivered')
      expect(entry.availability).toBe('cataloged')
    }
  })

  it('每个 entry 证据为准：evidenceFreshness=fresh 且 evidenceRefs 非空（可复现验证命令）', () => {
    for (const entry of PLUGIN_SEAM_CURATED_CATALOG) {
      expect(entry.evidenceFreshness).toBe('fresh')
      expect(entry.evidenceRefs.length).toBeGreaterThan(0)
    }
  })
})
