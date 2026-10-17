/**
 * 九屏幕件测试（v3-triz-contradiction-copilot W7 · tasks 7.3）。
 *
 * 覆盖：
 * - 3x3 九宫格与平民化层级标签（超系统/系统/子系统白话释义）；
 * - 预填脚手架加载（拉取 draft 渲染 9 格，防空白画布冷启动）；
 * - 单格文本编辑，纯本地状态流转，网络零写请求；
 * - 脏状态管理与未保存提示；
 * - 具 diagram:manage 权限时显式保存快照（POST / PATCH）；
 * - 恢复已保存版本优先呈现；
 * - 缺失 diagram:manage 时保存入口物理隐藏与中性提示。
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { TrizNineWindowsChartLens } from '@/components/next/charts/lenses/triz/TrizNineWindowsChartLens'
import {
  installTrizGalleryFakeBackend,
  makeSampleNineWindowsDraft,
  TEST_PROJECT_ID,
  type TrizGalleryFakeBackend,
} from './_next-triz-gallery-fixtures'

let backend: TrizGalleryFakeBackend

function setPermissions(permissions: string[]) {
  useAuthStore.setState({
    permissions,
    currentOrganizationId: 1,
  })
}

beforeEach(() => {
  backend = installTrizGalleryFakeBackend()
  setPermissions(['project:view', 'diagram:manage'])
})

afterEach(() => {
  backend.restore()
})

describe('7.3 九屏幕件（TrizNineWindowsChartLens）', () => {
  test('3x3 九宫格与预填脚手架加载：初次打开拉取预填草案，9 格均有内容（无空白画布）', async () => {
    render(<TrizNineWindowsChartLens projectId={TEST_PROJECT_ID} />)

    // 等待拉取完成
    await waitFor(() => {
      expect(backend.count('/triz-gallery/prefill')).toBeGreaterThanOrEqual(1)
    })

    // 验证平民化系统层级与时间轴标签
    expect(screen.getByText('九屏幕空间推演 (3×3 矩阵)')).toBeInTheDocument()
    expect(screen.getByText('外部环境 / 市场 / 组织')).toBeInTheDocument()
    expect(screen.getByText('当前系统')).toBeInTheDocument()
    expect(screen.getByText('组件 / 模块 / 角色')).toBeInTheDocument()

    // 验证 9 个格子均渲染
    const allCells = document.querySelectorAll('[data-nine-window-cell]')
    expect(allCells).toHaveLength(9)

    // 核心格展示
    expect(screen.getByText('核心格')).toBeInTheDocument()

    // 验证预填脚手架来源标识
    const badge = document.querySelector('[data-nine-windows-source-badge]')
    expect(badge?.textContent).toContain('预填脚手架')

    // 加载过程零写操作
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('单格内容编辑与脏状态：打字编辑实时更新，出现未保存提示，期间零写请求', async () => {
    render(<TrizNineWindowsChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('九屏幕空间推演 (3×3 矩阵)')).toBeInTheDocument()
    })

    // 初始状态下无未保存提示
    expect(document.querySelector('[data-unsaved-badge]')).toBeNull()
    expect(document.querySelector('[data-unsaved-warning-banner]')).toBeNull()

    // 找到核心格外的某个格子 textarea 进行编辑
    const pastSuperCell = document.querySelector('[data-nine-window-cell="past.supersystem"]')
    expect(pastSuperCell).not.toBeNull()
    const textarea = pastSuperCell?.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()

    // 输入新推演内容
    fireEvent.change(textarea, {
      target: { value: '修改后的外部组织环境推演：团队由原本的集中办公转变为完全异步远程协作。' },
    })

    // 脏状态提示激活
    expect(document.querySelector('[data-unsaved-badge]')).not.toBeNull()
    expect(document.querySelector('[data-unsaved-warning-banner]')).not.toBeNull()

    // 严格断言：编辑打字期间零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })

  test('保存快照（POST）：有 diagram:manage 权限时显式保存，发出一次写请求并清除未保存状态', async () => {
    render(<TrizNineWindowsChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('九屏幕空间推演 (3×3 矩阵)')).toBeInTheDocument()
    })

    // 触发编辑以激活保存按钮
    const futureSysCell = document.querySelector('[data-nine-window-cell="future.system"]')
    const textarea = futureSysCell?.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '系统全面具备弹性扩缩与无感知灰度能力。' } })

    const saveButton = screen.getByRole('button', { name: '保存九屏幕' })
    expect(saveButton).toBeEnabled()

    // 点击保存
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('九屏幕已显式落库保存')).toBeInTheDocument()
    })

    // 脏状态清除
    expect(document.querySelector('[data-unsaved-badge]')).toBeNull()

    // 严格断言：只发出了一次 POST 写请求到 triz-gallery-artifacts
    const writeCalls = backend.writeCalls()
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]!.method).toBe('POST')
    expect(writeCalls[0]!.url).toContain('/triz-gallery-artifacts')
    expect(writeCalls[0]!.body?.artifactType).toBe('nine_windows')
  })

  test('恢复已保存版本（PATCH）：优先回显已保存快照，再次编辑保存触发 PATCH 更新', async () => {
    // 预置已保存的快照产物
    const sampleDraft = makeSampleNineWindowsDraft()
    backend.setArtifacts([
      {
        id: 701,
        organizationId: 1,
        projectId: TEST_PROJECT_ID,
        artifactType: 'nine_windows',
        artifactTypeLabel: '九屏幕分析',
        content: {
          cells: sampleDraft.cells.map((c) =>
            c.key === 'present.system'
              ? { ...c, text: '【已保存版本】现存关键痛点已落库持久化' }
              : c,
          ),
          centerKey: 'present.system',
          filledCells: 9,
          savedAt: '2026-09-01T12:00:00.000Z',
        },
        version: 1,
        isCurrent: true,
        createdBy: 1,
        updatedBy: null,
        createdAt: '2026-09-01T12:00:00.000Z',
        updatedAt: '2026-09-01T12:00:00.000Z',
        deletedAt: null,
        deleted: false,
      },
    ])

    render(<TrizNineWindowsChartLens projectId={TEST_PROJECT_ID} />)

    // 等待已存版本加载
    await waitFor(() => {
      const badge = document.querySelector('[data-nine-windows-source-badge]')
      expect(badge?.textContent).toContain('已加载已存版本')
    })

    // 回显已存内容
    const centerCell = document.querySelector('[data-nine-window-cell="present.system"]')
    const centerTextarea = centerCell?.querySelector('textarea') as HTMLTextAreaElement
    expect(centerTextarea.value).toBe('【已保存版本】现存关键痛点已落库持久化')

    // 再次编辑
    fireEvent.change(centerTextarea, {
      target: { value: '【已保存版本 V2】第二次修改核心痛点' },
    })

    // 触发保存
    const saveBtn = screen.getByRole('button', { name: '保存九屏幕' })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(screen.getByText('九屏幕已显式落库保存')).toBeInTheDocument()
    })

    // 断言发出了 PATCH 请求且目标为 id 701
    const writeCalls = backend.writeCalls()
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]!.method).toBe('PATCH')
    expect(writeCalls[0]!.url).toContain('/triz-gallery-artifacts/701')
  })

  test('权限阻断与中性提示：缺少 diagram:manage 时保存入口物理隐藏并给中性提示', async () => {
    setPermissions(['project:view'])

    render(<TrizNineWindowsChartLens projectId={TEST_PROJECT_ID} />)

    await waitFor(() => {
      expect(screen.getByText('九屏幕空间推演 (3×3 矩阵)')).toBeInTheDocument()
    })

    // 保存按钮被物理隐藏
    expect(screen.queryByRole('button', { name: '保存九屏幕' })).toBeNull()

    // 出现中性只读提示
    expect(screen.getByText('当前账号仅具只读权限，保存入口已隐藏')).toBeInTheDocument()

    // 全程零写请求
    expect(backend.writeCalls()).toHaveLength(0)
  })
})
