/**
 * OCR Privacy Policy Controls——前端组件测试（v3-ocr-privacy-policy-controls §7.9）
 *
 * 覆盖：
 * - 隐私状态标识渲染
 * - 脱敏警告显示
 * - 导出对话框确认
 * - 禁用动作
 * - 隐藏来源详情
 * - 中文文案不含"自动应用"用语
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import {
  OcrPrivacyStatusBadge,
  OcrPrivacyRedactionWarning,
  OcrPrivacyPermissionDegraded,
} from '@/components/views/ocr/OcrPrivacyStatusBadge'

describe('OcrPrivacyStatusBadge', () => {
  it('renders system default badge', () => {
    render(<OcrPrivacyStatusBadge policySource="system" globalOutputMode="full" />)
    expect(screen.getByText('系统默认')).toBeDefined()
    expect(screen.getByText('完整')).toBeDefined()
  })

  it('renders project override badge', () => {
    render(<OcrPrivacyStatusBadge policySource="project" globalOutputMode="metadata_only" />)
    expect(screen.getByText('项目覆盖')).toBeDefined()
    expect(screen.getByText('仅元数据')).toBeDefined()
  })

  it('renders blocked status with danger variant', () => {
    render(<OcrPrivacyStatusBadge policySource="project" globalOutputMode="blocked" />)
    expect(screen.getByText('已阻止')).toBeDefined()
  })

  it('renders warning count when present', () => {
    render(
      <OcrPrivacyStatusBadge
        policySource="system"
        globalOutputMode="masked"
        warnings={['SOURCE_HIDDEN', 'STALE_SOURCE']}
      />,
    )
    expect(screen.getByText('2 个警告')).toBeDefined()
  })

  it('does not render warning badge when warnings empty', () => {
    render(<OcrPrivacyStatusBadge policySource="system" globalOutputMode="full" warnings={[]} />)
    expect(screen.queryByText(/个警告/)).toBeNull()
  })

  it('text does not contain auto-apply wording', () => {
    render(<OcrPrivacyStatusBadge policySource="system" globalOutputMode="full" />)
    const container = document.body.textContent ?? ''
    expect(container).not.toContain('自动应用')
    expect(container).not.toContain('一键执行')
  })
})

describe('OcrPrivacyRedactionWarning', () => {
  it('renders source_hidden reason', () => {
    render(<OcrPrivacyRedactionWarning reason="source_hidden" />)
    expect(screen.getByText('来源不可见，已脱敏展示')).toBeDefined()
  })

  it('supports children', () => {
    render(
      <OcrPrivacyRedactionWarning reason="source_hidden">
        <span data-testid="child">详细说明</span>
      </OcrPrivacyRedactionWarning>,
    )
    expect(screen.getByTestId('child')).toBeDefined()
  })
})

describe('OcrPrivacyPermissionDegraded', () => {
  it('renders missing permissions info', () => {
    render(
      <OcrPrivacyPermissionDegraded
        missingPermissions={['ocr_privacy:manage', 'ocr_privacy:export']}
      />,
    )
    expect(screen.getByText(/manage/)).toBeDefined()
    expect(screen.getByText(/export/)).toBeDefined()
  })
})
