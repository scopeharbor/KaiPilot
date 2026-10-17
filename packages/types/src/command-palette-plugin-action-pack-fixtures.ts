/**
 * command-palette-plugin-action-pack-fixtures —— 官方 Command Palette 插件命令包
 * 确定性 fixtures（v3-command-palette-plugin-action-pack）。
 *
 * - 正向：官方四命令包（discover / query / open-form / open-preview），全部为
 *   宿主持有动作、organization scope、零网络零 provider 调用。
 * - 负向：直接写入 action ref、脚本/URL 属性、冲突 identity、损坏 digest、未知 action ref。
 * - release metadata 组装器：供后端安装生命周期测试/E2E 以既有 seeding 模式发布该包。
 *
 * 所有数据都是声明式本机数据：无可执行内容、无真实外部配置。
 */

import {
  COMMAND_ACTION_PACK_SCHEMA_VERSION,
  OFFICIAL_COMMAND_ACTION_PACK_PLUGIN_ID,
  PLUGIN_SEAM_UI_COMMAND,
  PLUGIN_SEAM_UI_COMMAND_VERSION,
  computeCommandActionPackDigest,
  type CommandActionPackManifestV1,
} from './command-palette-plugin-action-pack.js'
import { PLUGIN_UI_COMMAND_SCHEMA_VERSION } from './plugin-ui-command.js'

// =============================================================================
// 1. 官方命令包（正向 fixture）
// =============================================================================

/** 官方四命令包：发现 / 只读查询 / 打开表单 / 打开预览。 */
export const OFFICIAL_COMMAND_ACTION_PACK: CommandActionPackManifestV1 = {
  schemaVersion: COMMAND_ACTION_PACK_SCHEMA_VERSION,
  packId: OFFICIAL_COMMAND_ACTION_PACK_PLUGIN_ID,
  version: '1.0.0',
  title: '开项官方插件命令包',
  description: '已启用官方插件的发现、只读查询、表单与预览入口（全部由宿主持有执行）。',
  commands: [
    {
      version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
      contributionKey: 'discover-plugin-capabilities',
      surface: 'command-palette',
      label: '浏览插件能力',
      keywords: ['插件', '发现', '能力', 'plugins'],
      iconKey: 'Search',
      actionKey: 'navigate',
      actionParams: { route: '/settings/integrations' },
      scopeKind: 'organization',
    },
    {
      version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
      contributionKey: 'query-plugin-activity',
      surface: 'command-palette',
      label: '查看插件活动记录',
      keywords: ['插件', '查询', '活动', '审计'],
      iconKey: 'FileText',
      actionKey: 'navigate',
      actionParams: { route: '/settings/audit-logs' },
      scopeKind: 'organization',
    },
    {
      version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
      contributionKey: 'open-ai-project-intent-form',
      surface: 'command-palette',
      label: '打开 AI 项目意向表单',
      keywords: ['插件', '表单', '项目', '意向'],
      iconKey: 'HelpCircle',
      actionKey: 'open-form',
      actionParams: { formId: 'ai-project-intent' },
      scopeKind: 'organization',
    },
    {
      version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
      contributionKey: 'open-sample-action-preview',
      surface: 'command-palette',
      label: '预览插件建议操作',
      keywords: ['插件', '预览', '建议', 'preview'],
      iconKey: 'Shield',
      actionKey: 'open-plugin-action-preview',
      actionParams: { actionRef: 'official-command-action-pack/sample-proposal@1.0.0' },
      scopeKind: 'organization',
    },
  ],
}

/** 官方包 canonical digest（同版本重复构建恒定）。 */
export const OFFICIAL_COMMAND_ACTION_PACK_DIGEST = computeCommandActionPackDigest(
  OFFICIAL_COMMAND_ACTION_PACK,
)

// =============================================================================
// 2. 负向 fixtures
// =============================================================================

/** 从官方包派生修改版的基础助手。 */
export function makeActionPackFixture(
  overrides: Partial<CommandActionPackManifestV1>,
): CommandActionPackManifestV1 {
  return {
    ...OFFICIAL_COMMAND_ACTION_PACK,
    ...overrides,
  }
}

/** 负例：携带直接写入 action ref 的违规 contribution。 */
export function makeDirectWriteActionPack(): CommandActionPackManifestV1 {
  return makeActionPackFixture({
    commands: [
      {
        version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
        contributionKey: 'write-project-record',
        surface: 'command-palette',
        label: '直接写入项目',
        iconKey: 'CheckCircle',
        actionKey: 'update',
        actionParams: { projectId: '1' },
        scopeKind: 'organization',
      },
    ],
  })
}

/** 负例：携带脚本/URL 危险属性的包。 */
export function makeScriptedActionPack(): CommandActionPackManifestV1 {
  return {
    ...makeActionPackFixture({}),
    commands: [
      {
        version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
        contributionKey: 'scripted-entry',
        surface: 'command-palette',
        label: '脚本入口',
        iconKey: 'Search',
        actionKey: 'navigate',
        actionParams: { route: '/settings/integrations' },
        scopeKind: 'organization',
        // 故意注入危险属性（脚本/远程 URL 载体）
        ...({ script: 'eval(1)', url: 'https://evil.example' } as Record<string, unknown>),
      } as unknown as CommandActionPackManifestV1['commands'][number],
    ],
  }
}

/** 负例：同包内冲突 identity（重复 contributionKey）。 */
export function makeConflictingIdentityActionPack(): CommandActionPackManifestV1 {
  const base = OFFICIAL_COMMAND_ACTION_PACK.commands[0]
  return makeActionPackFixture({
    commands: [base!, { ...base! }],
  })
}

/** 负例：未知 action ref。 */
export function makeUnknownActionRefActionPack(): CommandActionPackManifestV1 {
  return makeActionPackFixture({
    commands: [
      {
        version: PLUGIN_UI_COMMAND_SCHEMA_VERSION,
        contributionKey: 'mystery-entry',
        surface: 'command-palette',
        label: '神秘入口',
        iconKey: 'Search',
        actionKey: 'teleport',
        actionParams: {},
        scopeKind: 'organization',
      },
    ],
  })
}

/** 负例：损坏 digest（digest 与内容不匹配）。 */
export function makeCorruptedDigestFixture(): {
  pack: CommandActionPackManifestV1
  digest: string
} {
  return {
    pack: OFFICIAL_COMMAND_ACTION_PACK,
    digest: 'deadbeef',
  }
}

// =============================================================================
// 3. release metadata 组装（后端安装生命周期 seeding 用）
// =============================================================================

/**
 * 把官方包组装成私有目录 release.metadata 形状：
 * contributions[] 与 manifest 一一对应，payload 内嵌单条命令声明，
 * permissions 声明只读、无网络、无需确认。
 */
export function buildOfficialCommandActionPackReleaseMetadata(): Record<string, unknown> {
  return {
    name: OFFICIAL_COMMAND_ACTION_PACK.title,
    contributions: OFFICIAL_COMMAND_ACTION_PACK.commands.map((command) => ({
      contributionKey: command.contributionKey,
      seamKey: PLUGIN_SEAM_UI_COMMAND,
      seamVersion: PLUGIN_SEAM_UI_COMMAND_VERSION,
      title: command.label,
      payload: command,
    })),
    permissions: [
      {
        permissionKey: 'aiproj.plugin.command-entry',
        seamKey: PLUGIN_SEAM_UI_COMMAND,
        sideEffect: 'read-only',
        network: 'none',
        purpose: '官方命令包的 Command Palette 入口声明（宿主持有执行）',
      },
    ],
  }
}
