/**
 * command-palette-plugin-action-pack.test.ts —— 官方 Command Palette 插件命令包契约测试
 * （v3-command-palette-plugin-action-pack 任务 1.3 / 2.2）。
 *
 * 覆盖：
 * - 合法包（官方四命令）通过校验且 digest 稳定
 * - 直接写入 action ref → blocking 拒绝整个违规 contribution
 * - 脚本/URL 危险属性 → blocking
 * - 冲突 identity（重复 contributionKey）→ blocking
 * - 损坏 digest → 校验失败
 * - 未知 action ref → blocking
 * - 同版本重复构建 / 字段乱序 / commands 乱序 → digest 恒定（任务 2.2）
 * - release metadata 组装形状与分派器校验
 * - findings 低敏（无敏感值泄漏）
 *
 * 纪律：零网络、零 provider、零业务写入；全部为纯函数断言。
 */
import { describe, it, expect } from 'vitest'

import {
  COMMAND_ACTION_PACK_ALLOWED_ACTION_REFS,
  COMMAND_ACTION_PACK_SCHEMA_VERSION,
  OFFICIAL_COMMAND_ACTION_PACK_PLUGIN_ID,
  PLUGIN_SEAM_UI_COMMAND,
  computeCommandActionPackDigest,
  isCommandActionPackAllowedActionRef,
  isForbiddenDirectWriteActionRef,
  normalizeCommandActionPack,
  validateCommandActionPack,
  validateUiCommandContributionPayload,
  verifyCommandActionPackDigest,
} from './command-palette-plugin-action-pack.js'
import {
  OFFICIAL_COMMAND_ACTION_PACK,
  OFFICIAL_COMMAND_ACTION_PACK_DIGEST,
  buildOfficialCommandActionPackReleaseMetadata,
  makeActionPackFixture,
  makeConflictingIdentityActionPack,
  makeCorruptedDigestFixture,
  makeDirectWriteActionPack,
  makeScriptedActionPack,
  makeUnknownActionRefActionPack,
} from './command-palette-plugin-action-pack-fixtures.js'

// =============================================================================
// 1. 常量与封闭词表
// =============================================================================

describe('command-action-pack constants', () => {
  it('schema version is "1"', () => {
    expect(COMMAND_ACTION_PACK_SCHEMA_VERSION).toBe('1')
  })

  it('official pack id is stable', () => {
    expect(OFFICIAL_COMMAND_ACTION_PACK_PLUGIN_ID).toBe('com.aiproj.official.command-action-pack')
  })

  it('allowed action refs are the closed safe-open + preview set', () => {
    expect(COMMAND_ACTION_PACK_ALLOWED_ACTION_REFS).toEqual([
      'navigate',
      'open-form',
      'open-confirm',
      'open-plugin-action-preview',
    ])
  })

  it('direct-write action refs are all forbidden', () => {
    for (const ref of [
      'write',
      'create',
      'update',
      'delete',
      'apply',
      'sync',
      'external-write',
      'execute',
    ]) {
      expect(isForbiddenDirectWriteActionRef(ref)).toBe(true)
    }
    expect(isForbiddenDirectWriteActionRef('navigate')).toBe(false)
    expect(isForbiddenDirectWriteActionRef('open-plugin-action-preview')).toBe(false)
  })

  it('type guard accepts allowed refs only', () => {
    expect(isCommandActionPackAllowedActionRef('navigate')).toBe(true)
    expect(isCommandActionPackAllowedActionRef('open-plugin-action-preview')).toBe(true)
    expect(isCommandActionPackAllowedActionRef('write')).toBe(false)
    expect(isCommandActionPackAllowedActionRef('teleport')).toBe(false)
  })
})

// =============================================================================
// 2. 合法包与官方包 fixture
// =============================================================================

describe('valid official pack', () => {
  it('official four-command pack validates cleanly', () => {
    const result = validateCommandActionPack(OFFICIAL_COMMAND_ACTION_PACK)
    expect(result.valid).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.normalizedPack?.commands).toHaveLength(4)
    expect(result.normalizedPack?.commands.map((c) => c.contributionKey)).toEqual([
      'discover-plugin-capabilities',
      'open-ai-project-intent-form',
      'open-sample-action-preview',
      'query-plugin-activity',
    ])
  })

  it('declares exactly discover/query/open-form/open-preview archetypes', () => {
    const actions = OFFICIAL_COMMAND_ACTION_PACK.commands.map((c) => c.actionKey)
    expect(actions).toContain('navigate')
    expect(actions).toContain('open-form')
    expect(actions).toContain('open-plugin-action-preview')
    // 全部命令都是宿主持有动作，零直接写入
    for (const cmd of OFFICIAL_COMMAND_ACTION_PACK.commands) {
      expect(isForbiddenDirectWriteActionRef(cmd.actionKey)).toBe(false)
    }
  })

  it('preview entry carries bounded stable actionRef only', () => {
    const preview = OFFICIAL_COMMAND_ACTION_PACK.commands.find(
      (c) => c.actionKey === 'open-plugin-action-preview',
    )
    expect(preview).toBeDefined()
    expect(preview!.actionParams?.actionRef).toBeTruthy()
    expect(preview!.actionParams!.actionRef.length).toBeLessThanOrEqual(200)
  })
})

// =============================================================================
// 3. 负例：直接写入 / 脚本 URL / 冲突 identity / 损坏 digest / 未知 action ref
// =============================================================================

describe('invalid packs fail closed', () => {
  it('direct-write action ref is rejected as effect-not-allowed', () => {
    const result = validateCommandActionPack(makeDirectWriteActionPack())
    expect(result.valid).toBe(false)
    const blocking = result.findings.filter((f) => f.severity === 'blocking')
    expect(
      blocking.some((f) => f.reason === 'effect-not-allowed' && f.actionKey === 'update'),
    ).toBe(true)
  })

  it('script/url properties are rejected at pack level and contribution level', () => {
    const result = validateCommandActionPack(makeScriptedActionPack())
    expect(result.valid).toBe(false)
    const refs = result.findings.map((f) => f.evidenceRef ?? '')
    expect(refs.some((r) => r.includes('forbidden-property:script'))).toBe(true)
    expect(refs.some((r) => r.includes('forbidden-property:url'))).toBe(true)
  })

  it('conflicting identity (duplicate contributionKey) is rejected', () => {
    const result = validateCommandActionPack(makeConflictingIdentityActionPack())
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.reason === 'contribution-duplicate')).toBe(true)
  })

  it('corrupted digest fails verification while content itself stays valid', () => {
    const { pack, digest } = makeCorruptedDigestFixture()
    expect(verifyCommandActionPackDigest(pack, digest)).toBe(false)
    // 内容本身合法——损坏的是外部记录的 digest
    expect(validateCommandActionPack(pack).valid).toBe(true)
  })

  it('unknown action ref is rejected as unknown-action-kind', () => {
    const result = validateCommandActionPack(makeUnknownActionRefActionPack())
    expect(result.valid).toBe(false)
    expect(
      result.findings.some((f) => f.reason === 'unknown-action-kind' && f.actionKey === 'teleport'),
    ).toBe(true)
  })

  it('malformed pack shapes are rejected without throwing', () => {
    expect(validateCommandActionPack(null).valid).toBe(false)
    expect(validateCommandActionPack('nope').valid).toBe(false)
    expect(validateCommandActionPack([]).valid).toBe(false)
    expect(
      validateCommandActionPack({ ...OFFICIAL_COMMAND_ACTION_PACK, commands: 'x' }).valid,
    ).toBe(false)
  })

  it('preview entry without actionRef is rejected', () => {
    const pack = makeActionPackFixture({
      commands: [
        {
          version: '1' as const,
          contributionKey: 'preview-no-ref',
          surface: 'command-palette',
          label: '无引用预览',
          iconKey: 'Shield',
          actionKey: 'open-plugin-action-preview',
          scopeKind: 'organization',
        },
      ],
    })
    const result = validateCommandActionPack(pack)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.evidenceRef === 'missing-param:actionRef')).toBe(true)
  })

  it('oversized preview actionRef is rejected', () => {
    const pack = makeActionPackFixture({
      commands: [
        {
          version: '1' as const,
          contributionKey: 'preview-long-ref',
          surface: 'command-palette',
          label: '超长引用预览',
          iconKey: 'Shield',
          actionKey: 'open-plugin-action-preview',
          actionParams: { actionRef: 'a'.repeat(201) },
          scopeKind: 'organization',
        },
      ],
    })
    const result = validateCommandActionPack(pack)
    expect(result.valid).toBe(false)
    expect(result.findings.some((f) => f.evidenceRef === 'param-value-too-long:actionRef')).toBe(
      true,
    )
  })
})

// =============================================================================
// 4. digest 稳定性（任务 2.2）
// =============================================================================

describe('digest stability', () => {
  it('fixture digest constant matches recomputation', () => {
    expect(computeCommandActionPackDigest(OFFICIAL_COMMAND_ACTION_PACK)).toBe(
      OFFICIAL_COMMAND_ACTION_PACK_DIGEST,
    )
    expect(
      verifyCommandActionPackDigest(
        OFFICIAL_COMMAND_ACTION_PACK,
        OFFICIAL_COMMAND_ACTION_PACK_DIGEST,
      ),
    ).toBe(true)
  })

  it('repeated builds of the same version produce identical digests', () => {
    const a = computeCommandActionPackDigest(OFFICIAL_COMMAND_ACTION_PACK)
    const b = computeCommandActionPackDigest(makeActionPackFixture({}))
    const c = computeCommandActionPackDigest(
      normalizeCommandActionPack(OFFICIAL_COMMAND_ACTION_PACK),
    )
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('digest ignores command array order', () => {
    const reordered = makeActionPackFixture({
      commands: [...OFFICIAL_COMMAND_ACTION_PACK.commands].reverse(),
    })
    expect(computeCommandActionPackDigest(reordered)).toBe(OFFICIAL_COMMAND_ACTION_PACK_DIGEST)
  })

  it('digest ignores keyword/permission list order but changes on content change', () => {
    const kwShuffled = makeActionPackFixture({
      commands: OFFICIAL_COMMAND_ACTION_PACK.commands.map((c) => ({
        ...c,
        keywords: c.keywords ? [...c.keywords].reverse() : undefined,
      })),
    })
    expect(computeCommandActionPackDigest(kwShuffled)).toBe(OFFICIAL_COMMAND_ACTION_PACK_DIGEST)

    const relabeled = makeActionPackFixture({
      title: '开项官方插件命令包 V2',
    })
    expect(computeCommandActionPackDigest(relabeled)).not.toBe(OFFICIAL_COMMAND_ACTION_PACK_DIGEST)
  })

  it('digest changes when a command payload changes', () => {
    const tweaked = makeActionPackFixture({
      commands: OFFICIAL_COMMAND_ACTION_PACK.commands.map((c) =>
        c.contributionKey === 'query-plugin-activity'
          ? { ...c, label: '查看插件活动记录（改）' }
          : c,
      ),
    })
    expect(computeCommandActionPackDigest(tweaked)).not.toBe(OFFICIAL_COMMAND_ACTION_PACK_DIGEST)
  })
})

// =============================================================================
// 5. release metadata 组装与分派器校验
// =============================================================================

describe('release metadata assembly', () => {
  it('builds one metadata contribution per command under ui-command seam', () => {
    const meta = buildOfficialCommandActionPackReleaseMetadata() as {
      name: string
      contributions: Array<{
        contributionKey: string
        seamKey: string
        seamVersion: string
        payload: unknown
      }>
      permissions: Array<{ permissionKey: string; network: string; sideEffect: string }>
    }
    expect(meta.contributions).toHaveLength(4)
    for (const c of meta.contributions) {
      expect(c.seamKey).toBe(PLUGIN_SEAM_UI_COMMAND)
      expect(c.seamVersion).toBe('1.0.0')
    }
    expect(meta.permissions[0]!.network).toBe('none')
    expect(meta.permissions[0]!.sideEffect).toBe('read-only')
  })

  it('every embedded payload passes the ui-command dispatcher validation', () => {
    const meta = buildOfficialCommandActionPackReleaseMetadata() as {
      contributions: Array<{ payload: unknown }>
    }
    for (const c of meta.contributions) {
      const res = validateUiCommandContributionPayload(c.payload)
      expect(res.valid).toBe(true)
      expect(res.normalizedPayload).toBeDefined()
    }
  })

  it('dispatcher rejects direct-write payloads and wrong seam versions', () => {
    const bad = validateUiCommandContributionPayload({
      version: '1' as const,
      contributionKey: 'bad-write',
      surface: 'command-palette',
      label: '坏写入',
      iconKey: 'CheckCircle',
      actionKey: 'delete',
      scopeKind: 'organization',
    })
    expect(bad.valid).toBe(false)

    const wrongVersion = validateUiCommandContributionPayload(
      OFFICIAL_COMMAND_ACTION_PACK.commands[0],
      '9.9.9',
    )
    expect(wrongVersion.valid).toBe(false)
  })
})

// =============================================================================
// 6. 低敏 finding 契约
// =============================================================================

describe('low-sensitivity findings contract', () => {
  it('findings never contain raw values beyond low-sensitivity evidence refs', () => {
    const result = validateCommandActionPack(makeScriptedActionPack())
    const serialized = JSON.stringify(result.findings)
    expect(serialized).not.toMatch(/eval\(/)
    expect(serialized).not.toMatch(/evil\.example/)
    expect(serialized.toLowerCase()).not.toContain('bearer')
    expect(serialized.toLowerCase()).not.toContain('authorization:')
  })

  it('findings are deterministically ordered across runs', () => {
    const a = validateCommandActionPack(makeScriptedActionPack()).findings
    const b = validateCommandActionPack(makeScriptedActionPack()).findings
    expect(a).toEqual(b)
  })
})
