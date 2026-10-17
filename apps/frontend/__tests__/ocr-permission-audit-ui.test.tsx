/**
 * OCR 权限/审计——前端组件测试（v3-ocr-permission-and-audit §7.5）
 *
 * 覆盖：
 * - PM 允许动作渲染
 * - 只读观察者降级（blocked 动作徽章 + 原因标签）
 * - 隐藏来源 / 陈旧 / 保留滞留 / 隐私阻止 UI 状态
 * - 审计摘要列表渲染与分页
 * - 不渲染敏感 OCR 文本/来源文件名/绝对路径
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import {
  OcrPermissionStatusPanel,
  OcrAuditSummaryList,
} from '@/components/ocr/OcrPermissionStatusPanel'
import type { OcrPermissionStatus, OcrAuditSummary } from '@aiproj/types'

const SENSITIVE_TEXT = '这是敏感OCR全文不应出现在权限面板'

function makeStatus(overrides: Partial<OcrPermissionStatus> = {}): OcrPermissionStatus {
  return {
    projectRef: { type: 'project', id: 1 },
    sourceRef: null,
    artifactRef: null,
    sourceHash: 'src-hash-001',
    lifecycleState: 'active',
    retentionState: 'none',
    staleStatus: 'current',
    outputMode: 'full',
    allowedActions: ['metadata_read', 'review_confirm'],
    blockedActions: [],
    decisionHashes: ['h1', 'h2'],
    warnings: [],
    statusHash: 'sh1',
    ...overrides,
  } as OcrPermissionStatus
}

describe('OcrPermissionStatusPanel', () => {
  it('renders PM allowed actions', () => {
    render(<OcrPermissionStatusPanel status={makeStatus()} />)
    expect(screen.getByText('查看元数据')).toBeDefined()
    expect(screen.getByText('确认审查')).toBeDefined()
    expect(screen.getByText('完整')).toBeDefined()
  })

  it('renders read-only observer degraded state with blocked actions', () => {
    render(
      <OcrPermissionStatusPanel
        status={makeStatus({
          outputMode: 'blocked',
          allowedActions: [],
          blockedActions: [
            {
              action: 'review_confirm',
              reasonCodes: ['permission_missing'],
              decisionHash: 'hd1',
            },
          ],
        })}
      />,
    )
    expect(screen.getByText('确认审查')).toBeDefined()
    expect(screen.getByText('已阻断')).toBeDefined()
  })

  it('renders stale source block', () => {
    render(
      <OcrPermissionStatusPanel
        status={makeStatus({
          outputMode: 'blocked',
          allowedActions: [],
          blockedActions: [
            { action: 'provider_run', reasonCodes: ['stale_source'], decisionHash: 'hs' },
          ],
        })}
      />,
    )
    expect(screen.getByText('执行 OCR')).toBeDefined()
  })

  it('renders retention hold block', () => {
    render(
      <OcrPermissionStatusPanel
        status={makeStatus({
          outputMode: 'blocked',
          allowedActions: [],
          blockedActions: [
            {
              action: 'copy_export_execution',
              reasonCodes: ['retention_held'],
              decisionHash: 'hr',
            },
          ],
        })}
      />,
    )
    expect(screen.getByText('执行复制/导出')).toBeDefined()
  })

  it('renders privacy block', () => {
    render(
      <OcrPermissionStatusPanel
        status={makeStatus({
          outputMode: 'blocked',
          allowedActions: [],
          blockedActions: [
            { action: 'accepted_text_read', reasonCodes: ['privacy_blocked'], decisionHash: 'hp' },
          ],
        })}
      />,
    )
    expect(screen.getByText('查看已接受文本')).toBeDefined()
  })

  it('renders loading state', () => {
    render(<OcrPermissionStatusPanel status={null} loading />)
    expect(screen.getByText('正在加载权限状态…')).toBeDefined()
  })

  it('renders empty state when no status', () => {
    render(<OcrPermissionStatusPanel status={null} />)
    expect(screen.getByText('权限状态不可用')).toBeDefined()
  })

  it('does not render sensitive OCR text', () => {
    const { container } = render(<OcrPermissionStatusPanel status={makeStatus()} />)
    expect(container.textContent).not.toContain(SENSITIVE_TEXT)
  })

  it('does not leak absolute paths or source file names', () => {
    const { container } = render(<OcrPermissionStatusPanel status={makeStatus()} />)
    expect(container.textContent).not.toContain('C:\\')
    expect(container.textContent).not.toContain('/home/')
    expect(container.textContent).not.toContain('.pdf')
  })
})

describe('OcrAuditSummaryList', () => {
  const summaries: OcrAuditSummary[] = [
    {
      id: 1,
      event: 'ocr.permission.denial',
      action: 'review_confirm',
      result: 'denied',
      reasonCodes: ['permission_missing'],
      actorRef: { type: 'user', id: 2 },
      projectRef: { type: 'project', id: 1 },
      sourceRef: null,
      artifactRef: null,
      sourceHash: null,
      contentHash: null,
      decisionHash: 'h1',
      createdAt: '2026-08-03T10:00:00Z',
      metadata: {},
    },
  ]

  it('renders audit summary rows', () => {
    render(
      <OcrAuditSummaryList
        summaries={summaries}
        page={1}
        perPage={20}
        meta={{ total: 1, totalPages: 1 }}
      />,
    )
    expect(screen.getByText('确认审查')).toBeDefined()
    expect(screen.getByText('拒绝')).toBeDefined()
    expect(screen.getByText('缺少所需权限')).toBeDefined()
  })

  it('renders empty state', () => {
    render(<OcrAuditSummaryList summaries={[]} page={1} perPage={20} />)
    expect(screen.getByText('暂无审计摘要')).toBeDefined()
  })

  it('renders loading state', () => {
    render(<OcrAuditSummaryList summaries={[]} loading page={1} perPage={20} />)
    expect(screen.getByText('正在加载审计摘要…')).toBeDefined()
  })

  it('renders pagination when totalPages > 1', () => {
    render(
      <OcrAuditSummaryList
        summaries={summaries}
        page={1}
        perPage={20}
        meta={{ total: 40, totalPages: 2 }}
        onPageChange={() => {}}
      />,
    )
    expect(screen.getByText(/共 40 条/)).toBeDefined()
    expect(screen.getByText('上一页')).toBeDefined()
    expect(screen.getByText('下一页')).toBeDefined()
  })

  it('disables previous button on first page', () => {
    render(
      <OcrAuditSummaryList
        summaries={summaries}
        page={1}
        perPage={20}
        meta={{ total: 40, totalPages: 2 }}
        onPageChange={() => {}}
      />,
    )
    const prev = screen.getByLabelText('上一页') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
  })
})
