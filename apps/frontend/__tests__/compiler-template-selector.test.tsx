import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CompilerTemplateSelector } from '@/components/compiler/compiler-template-selector'
import { compilerTemplateKeys } from '@/hooks/use-compiler-templates'
import { useAuthStore } from '@/stores/auth-store'

const apiMocks = vi.hoisted(() => ({
  listCompilerTemplates: vi.fn(),
  getCompilerTemplateDetail: vi.fn(),
}))

vi.mock('@/lib/api/compiler-templates', () => apiMocks)

const summary = {
  templateId: 'ptpl_compiler_pilot_agile_start',
  name: '敏捷启动模板',
  description: '两周迭代的项目启动模板',
  pluginId: 'com.aiproj.pilot-compiler-template-pack',
  pluginVersion: '1.0.0',
  source: 'plugin' as const,
  version: 1,
  payloadDigest: 'sha256:payload',
  compatDigest: 'sha256:compat',
  seedDigest: 'sha256:seed',
  selectionDigest: 'selection-digest-12345678',
  projectType: 'software',
  objectives: ['两周交付可审查增量'],
  overridableParams: ['objectives'],
  wbsConstraints: { maxDepth: 4 },
}

const detail = {
  ...summary,
  seed: {
    projectType: 'software',
    objectives: ['两周交付可审查增量'],
    wbsConstraints: { maxDepth: 4 },
  },
  compat: { pluginVersion: '1.0.0', compatibilityDigest: 'sha256:compat' },
  snapshot: {
    pluginId: summary.pluginId,
    pluginVersion: summary.pluginVersion,
    templateId: summary.templateId,
    templateVersion: 1,
    payloadDigest: summary.payloadDigest,
    compatDigest: summary.compatDigest,
    seedDigest: summary.seedDigest,
    selectionDigest: summary.selectionDigest,
    seed: {
      projectType: 'software',
      objectives: ['两周交付可审查增量'],
      maxDepth: 4,
    },
  },
}

function renderSelector(props: React.ComponentProps<typeof CompilerTemplateSelector> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <CompilerTemplateSelector {...props} />
    </QueryClientProvider>,
  )
}

describe('CompilerTemplateSelector', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentOrganizationId: 101 })
    apiMocks.listCompilerTemplates.mockResolvedValue({ data: [summary], meta: { total: 1 } })
    apiMocks.getCompilerTemplateDetail.mockResolvedValue({ data: detail })
  })

  afterEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ currentOrganizationId: null })
  })

  it('binds list/detail query keys to organization scope', () => {
    expect(compilerTemplateKeys.list(101)).not.toEqual(compilerTemplateKeys.list(202))
    expect(compilerTemplateKeys.detail(101, summary.templateId)).not.toEqual(
      compilerTemplateKeys.detail(202, summary.templateId),
    )
  })

  it('renders loading, empty, and error states with retry affordance', async () => {
    apiMocks.listCompilerTemplates.mockReturnValueOnce(new Promise(() => {}))
    const loading = renderSelector()
    expect(await screen.findByText('正在加载模板列表…')).toBeDefined()
    loading.unmount()

    apiMocks.listCompilerTemplates.mockResolvedValueOnce({ data: [], meta: { total: 0 } })
    const empty = renderSelector()
    expect(await screen.findByText('暂无可用模板')).toBeDefined()
    empty.unmount()

    apiMocks.listCompilerTemplates.mockRejectedValueOnce(new Error('fixture failure'))
    renderSelector()
    expect(await screen.findByRole('alert')).toHaveTextContent('模板列表加载失败')
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined()
  })

  it('selects an uncontrolled template, loads detail, previews overrides, and clears safely', async () => {
    const onChange = vi.fn()
    renderSelector({
      onChange,
      userInput: { objectives: ['用户明确目标'] },
    })

    const radio = await screen.findByRole('radio', { name: '敏捷启动模板' })
    fireEvent.click(radio)
    expect(onChange).toHaveBeenCalledWith(summary.templateId, summary.selectionDigest)
    expect(await screen.findByText(/用户明确目标/)).toHaveTextContent('用户优先')
    await waitFor(() =>
      expect(apiMocks.getCompilerTemplateDetail).toHaveBeenCalledWith(summary.templateId),
    )

    fireEvent.click(screen.getByRole('button', { name: '清除选择（使用默认输入）' }))
    expect(onChange).toHaveBeenLastCalledWith(null, undefined)
    expect(screen.queryByText('模板详情预览')).toBeNull()
  })

  it('announces stale detail and preserves native keyboard focus semantics', async () => {
    apiMocks.getCompilerTemplateDetail.mockResolvedValueOnce({
      data: detail,
      meta: { stale: true, message: 'updated' },
    })
    renderSelector({ value: summary.templateId })

    const radio = await screen.findByRole('radio', { name: '敏捷启动模板' })
    radio.focus()
    expect(document.activeElement).toBe(radio)
    expect(await screen.findByText('模板已更新，选择的版本已过期，请重新选择。')).toHaveAttribute(
      'role',
      'alert',
    )
  })
})
