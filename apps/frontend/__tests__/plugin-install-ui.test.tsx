import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { PluginInstallList } from '../components/plugin-install/PluginInstallList'
import { PluginInstallConfirmDialog } from '../components/plugin-install/PluginInstallConfirmDialog'
import type { PluginInstallationDto } from '../lib/api/plugin-install'
import type { PluginInstallCommandPreview } from '@aiproj/types'

const MOCK_INSTALLATIONS: PluginInstallationDto[] = [
  {
    id: 1,
    organizationId: 101,
    pluginId: 'com.example.devtools',
    version: '1.0.0',
    releaseId: 12,
    status: 'installed',
    permissionConfirmation: null,
    packageDigest: 'sha256:pkg-001',
    manifestDigest: 'sha256:manifest-001',
    compatibilityDigest: 'sha256:compat-001',
    rowVersion: 1,
    uninstalledAt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  },
  {
    id: 2,
    organizationId: 101,
    pluginId: 'com.example.triz-skills',
    version: '2.1.0',
    releaseId: 18,
    status: 'enabled',
    permissionConfirmation: {
      confirmedBy: 'user-1',
      permissionDigest: 'sha256:perm-digest-001',
      permissionKeys: ['compiler:skill:view'],
      confirmedAt: '2026-08-19T01:00:00.000Z',
    },
    packageDigest: 'sha256:pkg-002',
    manifestDigest: 'sha256:manifest-002',
    compatibilityDigest: 'sha256:compat-002',
    rowVersion: 2,
    uninstalledAt: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-19T01:00:00.000Z',
  },
]

const MOCK_PREVIEW: PluginInstallCommandPreview = {
  previewHandle: 'inst-prev-handle-123',
  previewDigest: 'sha256:preview-digest-456',
  organizationId: '101',
  actorRef: 'user-1',
  action: 'enable',
  pluginId: 'com.example.devtools',
  pluginName: 'Developer Toolkit',
  currentVersion: '1.0.0',
  targetVersion: '1.0.0',
  releaseId: '12',
  currentStatus: 'installed',
  targetStatus: 'enabled',
  sourceHash: 'source-hash-1',
  affectedContributions: [
    {
      contributionKey: 'dev-skill',
      seamKey: 'skill-adapter.skill-bundle',
      seamVersion: '1.0.0',
      title: 'Dev Skill Bundle',
      skillKeyRef: 'dev-patterns',
    },
  ],
  requestedPermissions: [
    {
      permissionKey: 'compiler:skill:view',
      seamKey: 'skill-adapter.skill-bundle',
      sideEffect: 'read-only',
      network: 'none',
      purpose: '查看与匹配开发 Skill 规则',
    },
  ],
  permissionDigest: 'sha256:perm-digest-456',
  ttlSeconds: 300,
  createdAt: '2026-08-19T02:00:00.000Z',
  expiresAt: '2026-08-19T02:05:00.000Z',
}

describe('PluginInstallList 组件', () => {
  it('正常渲染安装列表与状态 Badge', () => {
    const onPreview = vi.fn()
    const onConfirm = vi.fn()

    render(
      <PluginInstallList
        installations={MOCK_INSTALLATIONS}
        onPreviewAction={onPreview}
        onConfirmAction={onConfirm}
      />,
    )

    expect(screen.getByText('com.example.devtools')).toBeInTheDocument()
    expect(screen.getByText('已安装 (未启用)')).toBeInTheDocument()
    expect(screen.getByText('com.example.triz-skills')).toBeInTheDocument()
    expect(screen.getByText('已启用')).toBeInTheDocument()
  })

  it('空态与加载态正确展示', () => {
    const onPreview = vi.fn()
    const onConfirm = vi.fn()

    const { unmount, container } = render(
      <PluginInstallList
        installations={[]}
        loading={true}
        onPreviewAction={onPreview}
        onConfirmAction={onConfirm}
      />,
    )
    expect(container.querySelector('[data-install-skeleton]')).toBeInTheDocument()
    unmount()

    render(
      <PluginInstallList
        installations={[]}
        loading={false}
        onPreviewAction={onPreview}
        onConfirmAction={onConfirm}
      />,
    )
    expect(screen.getByText('暂无已安装插件')).toBeInTheDocument()
  })

  it('RBAC 门控：canManage 为 false 时隐藏全部操作按钮', () => {
    const onPreview = vi.fn()
    const onConfirm = vi.fn()

    const { container } = render(
      <PluginInstallList
        installations={MOCK_INSTALLATIONS}
        canManage={false}
        onPreviewAction={onPreview}
        onConfirmAction={onConfirm}
      />,
    )

    expect(container.querySelector('[data-install-actions]')).toBeNull()
    expect(container.querySelector('[data-action-enable]')).toBeNull()
    expect(container.querySelector('[data-action-disable]')).toBeNull()
    expect(container.querySelector('[data-action-uninstall]')).toBeNull()
  })

  it('点击启用按钮触发预览生成', async () => {
    const onPreview = vi.fn().mockResolvedValue(MOCK_PREVIEW)
    const onConfirm = vi.fn()

    render(
      <PluginInstallList
        installations={MOCK_INSTALLATIONS}
        canManage={true}
        onPreviewAction={onPreview}
        onConfirmAction={onConfirm}
      />,
    )

    const enableBtn = screen.getByRole('button', { name: '启用' })
    fireEvent.click(enableBtn)

    expect(onPreview).toHaveBeenCalledWith('enable', 'com.example.devtools')
  })
})

describe('PluginInstallConfirmDialog 组件', () => {
  it('展示贡献影响面与权限清单', () => {
    render(
      <PluginInstallConfirmDialog
        open={true}
        action="enable"
        preview={MOCK_PREVIEW}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Developer Toolkit')).toBeInTheDocument()
    expect(screen.getByText('Dev Skill Bundle')).toBeInTheDocument()
    expect(screen.getByText('dev-patterns')).toBeInTheDocument()
    expect(screen.getByText('compiler:skill:view')).toBeInTheDocument()
    expect(screen.getByText('查看与匹配开发 Skill 规则')).toBeInTheDocument()
  })

  it('启用操作未勾选权限确认时禁用确认按钮，勾选后启用', () => {
    const onConfirm = vi.fn()
    render(
      <PluginInstallConfirmDialog
        open={true}
        action="enable"
        preview={MOCK_PREVIEW}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    const confirmBtn = screen.getByRole('button', { name: '确认启用插件' })
    expect(confirmBtn).toBeDisabled()

    // 勾选确认 Checkbox
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    expect(confirmBtn).not.toBeDisabled()

    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledWith({
      previewHandle: 'inst-prev-handle-123',
      previewDigest: 'sha256:preview-digest-456',
      permissionConfirmed: true,
      permissionDigest: 'sha256:perm-digest-456',
    })
  })

  it('停用/卸载等非启用操作默认允许提交（无需权限 Checkbox）', () => {
    const onConfirm = vi.fn()
    const uninstallPreview: PluginInstallCommandPreview = {
      ...MOCK_PREVIEW,
      action: 'uninstall',
      targetStatus: 'uninstalled',
    }

    render(
      <PluginInstallConfirmDialog
        open={true}
        action="uninstall"
        preview={uninstallPreview}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByRole('checkbox')).toBeNull()

    const confirmBtn = screen.getByRole('button', { name: '确认卸载插件' })
    expect(confirmBtn).not.toBeDisabled()

    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledWith({
      previewHandle: 'inst-prev-handle-123',
      previewDigest: 'sha256:preview-digest-456',
      permissionConfirmed: undefined,
      permissionDigest: undefined,
    })
  })

  it('点击取消按钮触发 onClose 回调', () => {
    const onClose = vi.fn()
    render(
      <PluginInstallConfirmDialog
        open={true}
        action="enable"
        preview={MOCK_PREVIEW}
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    )

    const cancelBtn = screen.getByRole('button', { name: '取消' })
    fireEvent.click(cancelBtn)
    expect(onClose).toHaveBeenCalled()
  })
})
