// @aiproj/types — copilot-first-party-tool-pack 单测（任务 1.3/1.4）。
//
// 覆盖：同版本重复构建 digest 稳定、零网络声明、低敏 provenance、
// 损坏/篡改包 blocking、结构校验与 class/permission 一致性。

import { describe, expect, it } from 'vitest'

import {
  COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD,
  COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID,
  COPILOT_FIRST_PARTY_TOOL_PACK_VERSION,
  FIRST_PARTY_TOOL_IDS,
  OFFICIAL_PACK_FIXTURE_NOW_ISO,
  OFFICIAL_TOOL_DIGEST_REGISTRY,
  OFFICIAL_TOOL_PROJECT_QUERY,
  OFFICIAL_TOOL_RISK_EXPLAINER,
  OFFICIAL_TOOL_TRIZ_ADVISOR,
  OFFICIAL_TOOL_WEEKLY_REPORT_DRAFT,
  buildOfficialToolPackProvenance,
  computeOfficialToolPackManifestDigest,
  computeOfficialToolPackPayloadDigest,
  validateOfficialToolPackPayload,
  validateProvenanceNoSensitiveData,
  verifyOfficialToolPackIntegrity,
} from './copilot-first-party-tool-pack.js'
import {
  COPILOT_TOOL_HOST_CONTRACT_VERSION,
  PLUGIN_SEAM_COPILOT_TOOL,
} from './copilot-plugin-tool-contract.js'
import { validatePluginContributionPayload } from './plugin-skill-adapter.js'
import { OFFICIAL_PACK_HOST_PERMISSION_WHITELIST } from './copilot-first-party-tool-pack.js'

describe('copilot-first-party-tool-pack — 稳定可复现身份', () => {
  it('固定第一方 identity 与完整 SemVer', () => {
    expect(COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID).toBe('com.aiproj.official.copilot-tool-pack')
    expect(COPILOT_FIRST_PARTY_TOOL_PACK_VERSION).toMatch(/^(\d+)\.(\d+)\.(\d+)$/)
    expect(FIRST_PARTY_TOOL_IDS).toHaveLength(4)
    for (const id of FIRST_PARTY_TOOL_IDS) {
      expect(id.startsWith('ctool_')).toBe(true)
    }
  })

  it('重复构建同一版本：manifest/package/payload/tool schema digest 完全一致', () => {
    const d1 = computeOfficialToolPackPayloadDigest()
    const d2 = computeOfficialToolPackPayloadDigest()
    expect(d1).toBe(d2)

    // 对象键序无关：逐工具逆序重建 key 后 digest 不变（工具数组顺序本身是确定性身份的一部分）
    const reverseKeys = <T extends Record<string, unknown>>(o: T): T =>
      Object.fromEntries(Object.entries(o).reverse()) as T
    const rebuilt = {
      schemaVersion: '1.0' as const,
      tools: COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools.map((t) => reverseKeys({ ...t })),
    }
    expect(computeOfficialToolPackPayloadDigest(rebuilt)).toBe(d1)

    const m1 = computeOfficialToolPackManifestDigest()
    const m2 = computeOfficialToolPackManifestDigest()
    expect(m1).toBe(m2)

    for (const tool of COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools) {
      expect(OFFICIAL_TOOL_DIGEST_REGISTRY[tool.toolId]).toBeDefined()
    }
  })

  it('四工具 hostContractVersion 与当前宿主契约一致，seam 登记存在', () => {
    for (const tool of COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools) {
      expect(tool.hostContractVersion).toBe(COPILOT_TOOL_HOST_CONTRACT_VERSION)
    }
    expect(PLUGIN_SEAM_COPILOT_TOOL).toBe('copilot-tool.declarative-tool')
  })
})

describe('copilot-first-party-tool-pack — 结构校验与建议边界', () => {
  it('官方负载通过契约校验（含宿主真实 RBAC 词表白名单）', () => {
    const res = validateOfficialToolPackPayload({
      knownPermissionKeys: [...OFFICIAL_PACK_HOST_PERMISSION_WHITELIST],
    })
    expect(res.valid).toBe(true)
    expect(res.normalizedPayload?.tools).toHaveLength(4)
  })

  it('side-effect 类别裁决：一 query 三 advisory，且无任何变更类权限', () => {
    expect(OFFICIAL_TOOL_PROJECT_QUERY.sideEffectClass).toBe('query')
    expect(OFFICIAL_TOOL_TRIZ_ADVISOR.sideEffectClass).toBe('advisory')
    expect(OFFICIAL_TOOL_WEEKLY_REPORT_DRAFT.sideEffectClass).toBe('advisory')
    expect(OFFICIAL_TOOL_RISK_EXPLAINER.sideEffectClass).toBe('advisory')

    for (const tool of COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools) {
      for (const p of tool.requiredPermissions) {
        expect(p.permissionKey).not.toMatch(/:(update|create|delete|execute|write)$/i)
      }
    }
  })

  it('中文 metadata 一等公民：名称/描述非空且在限内', () => {
    for (const tool of COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools) {
      expect(tool.name.length).toBeGreaterThan(0)
      expect(tool.name.length).toBeLessThanOrEqual(64)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeLessThanOrEqual(512)
      expect(tool.budget.maxResultBytes).toBeGreaterThan(0)
      expect(tool.budget.timeoutMs).toBeGreaterThan(0)
    }
  })

  it('经 manifest contribution dispatcher 分派校验通过；未声明 seam 拒绝', () => {
    const ok = validatePluginContributionPayload(
      PLUGIN_SEAM_COPILOT_TOOL,
      COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD,
    )
    expect(ok.valid).toBe(true)

    const bad = validatePluginContributionPayload(
      'copilot-tool.undeclared-side-door',
      COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD,
    )
    expect(bad.valid).toBe(false)
  })
})

describe('copilot-first-party-tool-pack — 零网络声明与损坏检测', () => {
  it('默认包完整性：intact=true 且零 finding', () => {
    const res = verifyOfficialToolPackIntegrity()
    expect(res.findings).toHaveLength(0)
    expect(res.intact).toBe(true)
  })

  it('单工具描述被篡改 → pack-digest-mismatch blocking（isolate 到该工具路径）', () => {
    const tampered = {
      schemaVersion: '1.0' as const,
      tools: COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools.map((t) =>
        t.toolId === OFFICIAL_TOOL_PROJECT_QUERY.toolId
          ? { ...t, description: t.description + '（被篡改）' }
          : t,
      ),
    }
    const res = verifyOfficialToolPackIntegrity(tampered)
    expect(res.intact).toBe(false)
    const mismatches = res.findings.filter((f) => f.code === 'pack-digest-mismatch')
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]!.path).toContain(OFFICIAL_TOOL_PROJECT_QUERY.toolId)
  })

  it('工具缺失/混入 → pack-tool-set-changed blocking', () => {
    const missing = {
      schemaVersion: '1.0' as const,
      tools: COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools.slice(0, 3),
    }
    const r1 = verifyOfficialToolPackIntegrity(missing)
    expect(r1.intact).toBe(false)
    expect(r1.findings.some((f) => f.code === 'pack-tool-set-changed')).toBe(true)

    const extra = {
      schemaVersion: '1.0' as const,
      tools: [
        ...COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools,
        {
          ...OFFICIAL_TOOL_PROJECT_QUERY,
          toolId: 'ctool_aiproj_rogue_tool',
          name: '混入工具',
        },
      ],
    }
    const r2 = verifyOfficialToolPackIntegrity(extra)
    expect(r2.findings.some((f) => f.message.includes('ctool_aiproj_rogue_tool'))).toBe(true)
  })

  it('零网络声明违规：声明文本出现 URL → blocking', () => {
    const withUrl = {
      schemaVersion: '1.0' as const,
      tools: [
        {
          ...OFFICIAL_TOOL_PROJECT_QUERY,
          inputSchema: {
            type: 'object' as const,
            properties: {
              webhook: { type: 'string' as const, description: '回调 https://evil.example.com' },
            },
            required: [],
          },
        },
        ...COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD.tools.slice(1),
      ],
    }
    const res = verifyOfficialToolPackIntegrity(withUrl)
    expect(res.intact).toBe(false)
    expect(res.findings.some((f) => f.code === 'pack-network-claim-violated')).toBe(true)
  })

  it('结构层损坏：未知顶层字段 → 契约校验 blocking 且 integrity 报告', () => {
    const broken = {
      ...(COPILOT_FIRST_PARTY_TOOL_PACK_PAYLOAD as unknown as Record<string, unknown>),
      runtimeHandler: 'scripts/do_evil.js',
    }
    const direct = validateOfficialToolPackPayload({})
    expect(direct.valid).toBe(true) // 官方常量本身干净
    const res = verifyOfficialToolPackIntegrity(broken)
    expect(res.intact).toBe(false)
    expect(res.findings.some((f) => f.code === 'pack-schema-invalid')).toBe(true)
  })
})

describe('copilot-first-party-tool-pack — 低敏 provenance 与确定性 fixtures', () => {
  it('provenance 只含 identity/digest/计数，禁存键扫描通过', () => {
    const p = buildOfficialToolPackProvenance()
    expect(p.pluginId).toBe(COPILOT_FIRST_PARTY_TOOL_PACK_PLUGIN_ID)
    expect(p.networkClaim).toBe('none')
    expect(p.distribution).toBe('first-party')
    expect(p.toolCount).toBe(4)
    const violations = validateProvenanceNoSensitiveData(p as unknown as Record<string, unknown>)
    expect(violations).toHaveLength(0)
  })

  it('provenance 禁存键扫描能捕获违规', () => {
    const violations = validateProvenanceNoSensitiveData({ apiKey: 'sk_x', result: '{}' })
    expect(violations.sort()).toEqual(['apiKey', 'result'])
  })

  it('确定性 fixture 时钟与词表可用（providerCalls=0 的基准）', () => {
    expect(OFFICIAL_PACK_FIXTURE_NOW_ISO).toBe('2026-08-25T08:00:00.000Z')
    expect(OFFICIAL_PACK_HOST_PERMISSION_WHITELIST).toContain('project:view')
    expect(OFFICIAL_PACK_HOST_PERMISSION_WHITELIST).toContain('triz_skill_layer:view')
  })
})
