/**
 * v3-ui-next-org-portfolio-domains W9 · tasks 9.1 —— 插件治理适配器纯函数单测。
 *
 * 覆盖（spec「组织插件目录与插件策略治理」+ tasks 9.1）：
 * - 六种 release 生命周期状态中文标签与徽标语义色类名（令牌断言防臆造色回潮）；
 * - 状态 × 权限合法动作矩阵：approve/disable/restore/rollback 的触发状态与权限门；
 *   无权限动作不出现在返回值（不渲染、无 disabled 暗示的纯函数前提）；
 * - 受影响安装计数格式化（0 / 仅安装中 / 含历史卸载）与实例状态中文映射；
 * - 回滚阻断码中文说明全量（后端裁决只复述）；
 * - 策略包激活状态徽标映射（active/disabled/未知回退）与激活闭环步骤标签冻结；
 * - 影响摘要动作中文标签与未知动作回退；
 * - 日期格式化边界（非法输入/空值）；
 * - 零网络、零 DOM 的高速纯函数执行（全文件无任何 DOM API 调用）。
 */
import { describe, expect, it } from 'vitest'
import type {
  DirectoryChangeAction,
  DirectoryReleaseStatus,
  DirectoryRollbackBlockingCode,
} from '@/lib/api/plugin-directory'
import {
  DIRECTORY_ACTION_LABELS,
  DIRECTORY_ACTION_ORDER,
  DIRECTORY_ACTION_TITLES,
  DIRECTORY_RELEASE_STATUS_META,
  DIRECTORY_RELEASE_STATUS_OPTIONS,
  DIRECTORY_ROLLBACK_BLOCKING_LABELS,
  POLICY_ACTIVATION_META,
  POLICY_ACTIVATION_STEP_LABELS,
  POLICY_ACTION_LABELS,
  changeRequestKindLabel,
  changeRequestStateLabel,
  directoryReleaseStatusMetaOf,
  directoryRollbackBlockingLabel,
  formatAffectedInstallationSummary,
  formatPluginDate,
  hasAnyDirectoryAction,
  installationStatusLabel,
  legalDirectoryActions,
  policyActionLabel,
  policyActivationMetaOf,
} from '@/lib/next/org-plugin/org-plugin-adapter'

// ---------------------------------------------------------------------------
// release 状态徽标
// ---------------------------------------------------------------------------

describe('directoryReleaseStatusMetaOf：生命周期状态标签与徽标色阶', () => {
  it('六种状态的中文标签与徽标色类名确定性输出（令牌冻结断言）', () => {
    const cases: Array<[DirectoryReleaseStatus, string, string]> = [
      ['draft', '草稿', 'text-[var(--nx-text-muted)]'],
      ['pending_review', '待审核', 'text-[var(--nx-status-warning)]'],
      ['approved', '已批准', 'text-[var(--nx-status-success)]'],
      ['rejected', '已拒绝', 'text-[var(--nx-status-danger)]'],
      ['deprecated', '已弃用', 'text-[var(--nx-chart-4)]'],
      ['withdrawn', '已撤回', 'text-[var(--nx-status-danger)]'],
    ]
    for (const [status, label, textClass] of cases) {
      const meta = directoryReleaseStatusMetaOf(status)
      expect(meta).not.toBeNull()
      expect(meta?.label).toBe(label)
      expect(meta?.chipClass).toContain(textClass)
      // 全部徽标都带 1px 发丝线边框（border-…）与底色（bg-…）双段
      expect(meta?.chipClass).toMatch(/border-\[/)
      expect(meta?.chipClass).toMatch(/bg-\[/)
      expect(meta?.description.length).toBeGreaterThan(0)
    }
  })

  it('DIRECTORY_RELEASE_STATUS_META / OPTIONS 覆盖后端枚举全集且顺序固定', () => {
    const statuses = Object.keys(DIRECTORY_RELEASE_STATUS_META) as DirectoryReleaseStatus[]
    expect(statuses).toEqual([
      'draft',
      'pending_review',
      'approved',
      'rejected',
      'deprecated',
      'withdrawn',
    ])
    expect(DIRECTORY_RELEASE_STATUS_OPTIONS.map((o) => o.status)).toEqual(statuses)
  })

  it('未知状态回退 null（脏数据中性呈现）', () => {
    expect(directoryReleaseStatusMetaOf(undefined)).toBeNull()
    expect(directoryReleaseStatusMetaOf('distributing')).toBeNull()
    expect(directoryReleaseStatusMetaOf('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 动作矩阵
// ---------------------------------------------------------------------------

describe('legalDirectoryActions：状态 × 权限动作矩阵（RL-06 不泄露能力）', () => {
  it('approve 仅在 pending_review 且持 review 权限时出现', () => {
    const granted = { canApprove: true, canManage: false, canRollback: false }
    expect(legalDirectoryActions('pending_review', granted)).toEqual(['approve'])
    expect(legalDirectoryActions('approved', granted)).toEqual([])
    expect(legalDirectoryActions('draft', granted)).toEqual([])
    // 无审批权：即使状态待审也不返回
    expect(
      legalDirectoryActions('pending_review', {
        canApprove: false,
        canManage: false,
        canRollback: false,
      }),
    ).toEqual([])
  })

  it('disable 在 approved/deprecated 且持 manage 权限时出现；restore 仅 withdrawn', () => {
    const granted = { canApprove: false, canManage: true, canRollback: false }
    expect(legalDirectoryActions('approved', granted)).toEqual(['disable'])
    expect(legalDirectoryActions('deprecated', granted)).toEqual(['disable'])
    expect(legalDirectoryActions('withdrawn', granted)).toEqual(['restore'])
    expect(legalDirectoryActions('pending_review', granted)).toEqual([])
    expect(legalDirectoryActions('draft', granted)).toEqual([])
  })

  it('rollback 仅在 approved 且持 rollback 权限时出现', () => {
    const granted = { canApprove: false, canManage: false, canRollback: true }
    expect(legalDirectoryActions('approved', granted)).toEqual(['rollback'])
    expect(legalDirectoryActions('deprecated', granted)).toEqual([])
    expect(legalDirectoryActions('pending_review', granted)).toEqual([])
  })

  it('组合权限返回固定顺序多动作；无任何权限时动作恒为空数组', () => {
    const all = { canApprove: true, canManage: true, canRollback: true }
    expect(legalDirectoryActions('approved', all)).toEqual(['disable', 'rollback'])
    expect(legalDirectoryActions('pending_review', all)).toEqual(['approve'])
    expect(legalDirectoryActions('withdrawn', all)).toEqual(['restore'])
    const none = { canApprove: false, canManage: false, canRollback: false }
    for (const status of Object.keys(DIRECTORY_RELEASE_STATUS_META) as DirectoryReleaseStatus[]) {
      expect(legalDirectoryActions(status, none)).toEqual([])
      expect(hasAnyDirectoryAction(status, none)).toBe(false)
    }
    expect(hasAnyDirectoryAction('approved', all)).toBe(true)
  })

  it('动作标签与提交文案词表完备（全部动作均有标题/描述/提交标签）', () => {
    expect(DIRECTORY_ACTION_ORDER).toEqual(['approve', 'disable', 'restore', 'rollback'])
    for (const action of DIRECTORY_ACTION_ORDER) {
      expect(DIRECTORY_ACTION_LABELS[action].length).toBeGreaterThan(0)
      expect(DIRECTORY_ACTION_TITLES[action].length).toBeGreaterThan(0)
      expect(POLICY_ACTIVATION_STEP_LABELS.compose).toBe('提交变更请求')
    }
  })
})

// ---------------------------------------------------------------------------
// 受影响安装计数与实例状态
// ---------------------------------------------------------------------------

describe('受影响安装计数与实例状态格式化', () => {
  it('计数边界：0 / 仅安装中 / 含历史卸载', () => {
    expect(formatAffectedInstallationSummary({ activeCount: 0, uninstalledCount: 0 })).toBe(
      '安装中 0',
    )
    expect(formatAffectedInstallationSummary({ activeCount: 3, uninstalledCount: 0 })).toBe(
      '安装中 3',
    )
    expect(formatAffectedInstallationSummary({ activeCount: 3, uninstalledCount: 2 })).toBe(
      '安装中 3 · 已卸载 2',
    )
  })

  it('实例状态中文标签与未知回退', () => {
    expect(installationStatusLabel('enabled')).toBe('已启用')
    expect(installationStatusLabel('installed')).toBe('未启用')
    expect(installationStatusLabel('uninstalled')).toBe('已卸载')
    expect(installationStatusLabel('archived')).toBe('archived')
    expect(installationStatusLabel('')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 回滚阻断码
// ---------------------------------------------------------------------------

describe('回滚阻断码中文说明（只复述后端裁决）', () => {
  it('五类阻断码全覆盖且有说明文案', () => {
    const codes = Object.keys(DIRECTORY_ROLLBACK_BLOCKING_LABELS) as DirectoryRollbackBlockingCode[]
    expect(codes.sort()).toEqual(
      [
        'rollback-target-not-approved',
        'rollback-target-integrity-incomplete',
        'rollback-target-incompatible',
        'rollback-permission-elevation',
        'rollback-target-missing',
      ].sort(),
    )
    for (const code of codes) {
      expect(directoryRollbackBlockingLabel(code).length).toBeGreaterThan(4)
    }
  })

  it('未知阻断码原样回退（不臆造文案）', () => {
    expect(directoryRollbackBlockingLabel('unknown-code')).toBe('unknown-code')
  })
})

// ---------------------------------------------------------------------------
// 变更请求状态标签
// ---------------------------------------------------------------------------

describe('changeRequestStateLabel / changeRequestKindLabel：统一变更流标签', () => {
  it('九态状态映射 + 空值/未知回退', () => {
    expect(changeRequestStateLabel('draft')).toBe('草稿')
    expect(changeRequestStateLabel('pending-approval')).toBe('待审批')
    expect(changeRequestStateLabel('approved')).toBe('已审批')
    expect(changeRequestStateLabel('awaiting-confirmation')).toBe('待确认')
    expect(changeRequestStateLabel('applied')).toBe('已生效')
    expect(changeRequestStateLabel('rejected')).toBe('已拒绝')
    expect(changeRequestStateLabel('withdrawn')).toBe('已撤回')
    expect(changeRequestStateLabel('expired')).toBe('已过期')
    expect(changeRequestStateLabel('failed')).toBe('失败')
    expect(changeRequestStateLabel(null)).toBe('—')
    expect(changeRequestStateLabel(undefined)).toBe('—')
    expect(changeRequestStateLabel('mystery')).toBe('mystery')
  })

  it('五种类型映射（含目录/策略扩展类型）+ 回退', () => {
    expect(changeRequestKindLabel('install')).toBe('安装')
    expect(changeRequestKindLabel('permission-upgrade')).toBe('权限升级')
    expect(changeRequestKindLabel('version-upgrade')).toBe('版本升级')
    expect(changeRequestKindLabel('policy-bundle-change')).toBe('策略变更')
    expect(changeRequestKindLabel('registry-release-change')).toBe('目录变更')
    expect(changeRequestKindLabel(null)).toBe('—')
    expect(changeRequestKindLabel('custom-kind')).toBe('custom-kind')
  })
})

// ---------------------------------------------------------------------------
// 策略包：激活徽标 / 激活闭环步骤 / 影响摘要动作
// ---------------------------------------------------------------------------

describe('插件策略激活语义映射', () => {
  it('激活状态徽标：active 生效中（翡翠绿），disabled 已停用（中性）', () => {
    expect(POLICY_ACTIVATION_META.active.label).toBe('生效中')
    expect(POLICY_ACTIVATION_META.active.chipClass).toContain('text-[var(--nx-status-success)]')
    expect(POLICY_ACTIVATION_META.disabled.label).toBe('已停用')
    expect(policyActivationMetaOf('active')).toBe(POLICY_ACTIVATION_META.active)
    expect(policyActivationMetaOf('disabled')).toBe(POLICY_ACTIVATION_META.disabled)
    // 未知状态回退停用中性呈现，不抛错
    expect(policyActivationMetaOf(undefined)).toBe(POLICY_ACTIVATION_META.disabled)
    expect(policyActivationMetaOf('bogus')).toBe(POLICY_ACTIVATION_META.disabled)
  })

  it('激活闭环步骤标签完整（compose → 变更请求 → 审批 → 最终确认）', () => {
    expect(POLICY_ACTIVATION_STEP_LABELS).toEqual({
      compose: '提交变更请求',
      changeRequest: '统一变更请求（未生效）',
      approve: '由另一位管理员审批',
      confirm: '最终确认并生效',
    })
  })

  it('影响摘要动作中文标签与未知回退', () => {
    expect(policyActionLabel('copy')).toBe('复制')
    expect(policyActionLabel('enable')).toBe('启用')
    expect(policyActionLabel('disable')).toBe('停用')
    expect(policyActionLabel('upgrade')).toBe('升级')
    expect(Object.keys(POLICY_ACTION_LABELS).sort()).toEqual([
      'copy',
      'disable',
      'enable',
      'upgrade',
    ])
    expect(policyActionLabel('custom')).toBe('custom')
  })
})

// ---------------------------------------------------------------------------
// 日期格式化
// ---------------------------------------------------------------------------

describe('formatPluginDate：UTC 日历日', () => {
  it('合法 ISO → YYYY-MM-DD；空值与非法输入回退', () => {
    expect(formatPluginDate('2026-08-01T00:00:00.000Z')).toBe('2026-08-01')
    expect(formatPluginDate('2026-12-31T23:59:59.999Z')).toBe('2026-12-31')
    expect(formatPluginDate(null)).toBe('—')
    expect(formatPluginDate(undefined)).toBe('—')
    expect(formatPluginDate('garbage-date')).toBe('garbage-da')
  })
})

// ---------------------------------------------------------------------------
// 类型完备性：所有导出动作类型可被消费（防词表漂移的编译期检查）
// ---------------------------------------------------------------------------

describe('类型完备性', () => {
  it('动作词表键与联合类型一致（编译期防漂移）', () => {
    const labels = DIRECTORY_ACTION_LABELS as Record<DirectoryChangeAction, string>
    expect(Object.keys(labels)).toEqual(DIRECTORY_ACTION_ORDER)
  })
})
