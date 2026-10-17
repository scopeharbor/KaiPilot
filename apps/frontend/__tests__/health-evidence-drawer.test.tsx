import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HealthEvidenceDrawer } from '@/components/project/HealthEvidenceDrawer'
import type { HealthDiagnosisCommandCenterFacts } from '@aiproj/types'

function makeDiagnosis(
  overrides: Partial<HealthDiagnosisCommandCenterFacts> = {},
): HealthDiagnosisCommandCenterFacts {
  return {
    sourceKey: 'health-diagnosis',
    diagnosisId: 9001,
    overallScore: 86,
    overallLabel: '良好',
    status: 'confirmed',
    stale: false,
    confirmedAt: '2026-08-30T10:00:00.000Z',
    dimensionScores: [
      { dimension: 'schedule', score: 82, severity: 'medium' },
      { dimension: 'risk', score: 90, severity: 'info' },
    ],
    ...overrides,
  }
}

function openDrawer(props: Partial<Parameters<typeof HealthEvidenceDrawer>[0]> = {}) {
  return render(
    <HealthEvidenceDrawer
      open
      onOpenChange={vi.fn()}
      projectId={101}
      diagnosis={makeDiagnosis()}
      freshness="current"
      {...props}
    />,
  )
}

describe('HealthEvidenceDrawer 只读证据抽屉（§5.9/5.10）', () => {
  test('展开证据：元数据、综合评分与维度得分可见', async () => {
    openDrawer()
    const drawer = await screen.findByTestId('health-evidence-drawer')
    expect(drawer).toBeInTheDocument()
    expect(screen.getByText('#9001')).toBeInTheDocument()
    expect(screen.getByText('已确认诊断')).toBeInTheDocument()
    expect(screen.getByText('当前有效')).toBeInTheDocument()
    expect(screen.getByLabelText('维度得分')).toHaveTextContent('schedule')
    expect(screen.getByLabelText('维度得分')).toHaveTextContent('82')
  })

  test('stale 证据显示过期徽标而非当前有效', async () => {
    openDrawer({ diagnosis: makeDiagnosis({ stale: true }), freshness: 'stale' })
    await screen.findByTestId('health-evidence-drawer')
    expect(screen.getByText('HEALTH_DIAGNOSIS_STALE')).toBeInTheDocument()
    expect(screen.queryByText('当前有效')).not.toBeInTheDocument()
  })

  test('无可用诊断：空态引导且不出现任何生成/刷新/确认控件', async () => {
    openDrawer({ diagnosis: null, freshness: null })
    await screen.findByTestId('health-evidence-drawer')
    expect(screen.getByText(/暂无已确认的健康诊断证据/)).toBeInTheDocument()
    // 全抽屉除 Radix 内建关闭按钮外零 button —— 无生成/刷新/确认入口
    const drawer = screen.getByTestId('health-evidence-drawer')
    const buttons = drawer.querySelectorAll('button')
    for (const b of Array.from(buttons)) {
      expect(b.getAttribute('aria-label')).toBe('关闭')
    }
    // 零表单控件（无任何可提交的写路径）
    expect(drawer.querySelectorAll('input, textarea, select, form')).toHaveLength(0)
  })

  test('敏感原始字段缺席：不暴露 inputSignature / outputHash / evidenceHash', async () => {
    openDrawer()
    await screen.findByTestId('health-evidence-drawer')
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('inputSignature')
    expect(text).not.toContain('outputHash')
    expect(text).not.toContain('evidenceHash')
  })

  test('关闭后焦点返回触发元素（Radix Dialog 焦点管理）', async () => {
    const onOpenChange = vi.fn()
    render(
      <div>
        <button type="button" onClick={() => undefined}>
          打开证据
        </button>
        <HealthEvidenceDrawer
          open
          onOpenChange={onOpenChange}
          projectId={101}
          diagnosis={makeDiagnosis()}
          freshness="current"
        />
      </div>,
    )
    await screen.findByTestId('health-evidence-drawer')
    // 点击 Radix 关闭按钮 → onOpenChange(false)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('移动全屏兜底：内容区默认 w-full（窄屏无横向溢出根因）', async () => {
    openDrawer()
    const drawer = await screen.findByTestId('health-evidence-drawer')
    // SheetContent 的 side=right 变体自带 w-full max-w-[560px]
    expect(drawer.className).toContain('w-full')
  })
})
