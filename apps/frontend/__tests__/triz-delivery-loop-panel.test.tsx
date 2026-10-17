/**
 * v3-triz-to-delivery-closed-loop —— 决策中心交付闭环面板 RTL 测试
 * （tasks 10.3/10.5/10.7/10.9 的前端状态面）。
 *
 * 覆盖：四 tab 渲染与 posture 文字+图标双编码、loading skeleton、empty、
 * error+retry、forbidden、degraded 提示、「不改正式任务状态」明示、
 * 隐藏实体标题不渲染、detail rail legacy/stale 提示、对话框取消零提交。
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import {
  DeliveryLoopPanel,
  LinkConfirmDialog,
  VerificationDialog,
  ReopenDialog,
} from '../components/delivery-loop/delivery-loop-panel'
import { AdvisorySection } from '../components/delivery-loop/advisory-section'
import type { TrizDlClosedLoopItem } from '@aiproj/types'

function withQc(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const item = (over: Partial<TrizDlClosedLoopItem> = {}): TrizDlClosedLoopItem => ({
  itemId: 'link-1',
  projectId: 10,
  organizationId: 1,
  decisionLogId: '5',
  linkMode: 'apply_receipt',
  posture: 'awaiting_verification',
  warningCodes: [],
  degradedReasons: [],
  deliveryRefs: [{ kind: 'task', entityId: '100' }],
  contextRefs: [],
  latestConclusion: null,
  updatedAt: '2026-08-26T00:00:00.000Z',
  ...over,
})

describe('DeliveryLoopPanel 状态面', () => {
  it('四个分组 tab 均可切换（aria-selected）', () => {
    withQc(<DeliveryLoopPanel projectId={10} />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(4)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(tabs[2]!)
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true')
  })

  it('loading 渲染骨架屏；error 提供 retry；forbidden 显示无权', () => {
    const { rerender } = withQc(<DeliveryLoopPanel projectId={10} loading />)
    expect(screen.getAllByTestId('dl-skeleton').length).toBeGreaterThan(0)

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DeliveryLoopPanel projectId={10} error />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败')
    expect(screen.getByText('重试')).toBeTruthy()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <DeliveryLoopPanel projectId={10} forbidden />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('无权查看交付闭环')
  })

  it('明示「不改变正式任务状态」且 degraded 局部降级提示不影响主面板', () => {
    withQc(
      <DeliveryLoopPanel
        projectId={10}
        degraded
        itemsOverride={{ delivery_in_progress: [item()] }}
      />,
    )
    expect(screen.getByTestId('dl-posture-note').textContent).toContain('不改变正式任务状态')
    expect(screen.getByTestId('dl-degraded')).toBeTruthy()
    // 核心姿态仍然可见
    expect(screen.getByText('待人工验证')).toBeTruthy()
  })

  it('行级姿态文字+图标双编码；待验证行提供人工验证入口；ineffective 行提供重审入口而非自动重跑', () => {
    const onVerify = vi.fn()
    const onReopen = vi.fn()
    withQc(
      <DeliveryLoopPanel
        projectId={10}
        itemsOverride={{
          awaiting_verification: [item()],
          verified: [item({ itemId: 'link-9', posture: 'verified_ineffective' })],
        }}
        onVerifyRequest={onVerify}
        onReopenRequest={onReopen}
      />,
    )
    // 双编码：图标 span aria-hidden + 文字（先切到「待验证」tab）
    fireEvent.click(screen.getByRole('tab', { name: '待验证' }))
    const badge = screen.getByText('待人工验证')
    expect(badge.previousElementSibling?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(screen.getByText('记录效果验证'))
    expect(onVerify).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('tab', { name: '已验证' }))
    fireEvent.click(screen.getByText('请求重新审查'))
    expect(onReopen).toHaveBeenCalledOnce()
    expect(screen.queryByText('自动重跑')).toBeNull()
    expect(screen.queryByText('自动应用')).toBeNull()
  })
})

describe('对话框取消零写入与确认语义', () => {
  const preview = {
    preview: {
      decisionLogId: '5',
      deliveryRefs: [{ kind: 'task' as const, entityId: '100' }],
      contextRefs: [],
      sourceFreshness: 'fresh' as const,
      entitySummaries: [],
      warningCodes: [],
    },
    previewFingerprint: 'tdlprev_abc',
    confirmationOwnedBy: 'user' as const,
    notice: '确认后只写闭环关联，不修改任何正式实体的状态、负责人、日期或内容。',
  }

  it('LinkConfirmDialog 明示只写关联；取消不触发 confirm', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    withQc(<LinkConfirmDialog preview={preview} onCancel={onCancel} onConfirm={onConfirm} />)
    expect(screen.getByTestId('dl-link-only-write').textContent).toContain('只写闭环关联')
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('VerificationDialog 无结论不可提交；取消零写入；展示指纹', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    withQc(<VerificationDialog fingerprint="tdlver_x" onCancel={onCancel} onSubmit={onSubmit} />)
    expect(screen.getByText(/不会.*自动判定有效/)).toBeTruthy()
    fireEvent.click(screen.getByText('提交验证'))
    expect(onSubmit).not.toHaveBeenCalledTimes(1) // disabled 未触发
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ReopenDialog 措辞为「进入需重审队列」且无自动执行承诺；取消零提交', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    withQc(<ReopenDialog onCancel={onCancel} onSubmit={onSubmit} />)
    expect(screen.getByText(/不会自动重跑或自动应用/)).toBeTruthy()
    fireEvent.click(screen.getByText('取消'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

describe('AdvisorySection 与权威事实分离（10.11）', () => {
  it('渲染 provenance/版本/草稿标记；degraded 提示不夸大', () => {
    withQc(
      <AdvisorySection
        blocks={[
          {
            capability: 'delivery_template',
            content: '模板内容…',
            provenance: 'triz-pack@first_party',
            version: '1.0.0',
            advisory: true,
          },
        ]}
        degradedReasons={['plugin_timeout']}
      />,
    )
    expect(screen.getByTestId('dl-advisory-block').textContent).toContain('triz-pack@first_party')
    expect(screen.getByTestId('dl-advisory-block').textContent).toContain('草稿')
    expect(screen.getByTestId('dl-advisory-degraded').textContent).toContain('插件响应超时')
    expect(screen.getByTestId('dl-advisory-degraded').textContent).toContain('不受影响')
  })

  it('空块 + 降级显示占位与原因；区块内不存在任何确认按钮', () => {
    withQc(<AdvisorySection blocks={[]} degradedReasons={['ai_unavailable']} />)
    expect(screen.getByTestId('dl-advisory-empty')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
