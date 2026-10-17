/**
 * 文档智能工作台 —— UI 组件测试（v3-document-intelligence-workbench §4.6 / §4.8 / §4.10 / §5.2）
 *
 * 覆盖：
 * - native document / not-started / unsupported MIME / processing / needs-review /
 *   ready / stale / blocked / unavailable 各状态的显式呈现
 * - 证据与治理视图：audit restricted、privacy、retention、profile disabled/invalid、
 *   null 计数不得渲染成 0，且不渲染任何禁止载荷
 * - Panel host：封闭 surface 映射、server-denied fail closed、unknown surface fail closed
 * - URL 状态：筛选/面板 round-trip 与非法参数清理
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import {
  buildDocumentIntelligenceSourceSummary,
  buildDocumentIntelligenceSourceDetail,
  parseIntelligenceUrlState,
  serializeIntelligenceUrlState,
  sanitizeIntelligenceUrlParams,
  type DocumentIntelligenceSourceSummary,
} from '@aiproj/types'
import { DocumentIntelligenceSourceList } from '../components/document-intelligence/DocumentIntelligenceSourceList'
import DocumentIntelligenceEvidencePanel from '../components/document-intelligence/DocumentIntelligenceEvidencePanel'
import { resolvePanelMountBlock } from '../components/document-intelligence/DocumentIntelligencePanelHost'

/** 用 fixture builder 造行，再按用例覆写维度/入口（保持契约一致） */
function row(
  overrides: Partial<DocumentIntelligenceSourceSummary>,
): DocumentIntelligenceSourceSummary {
  return { ...buildDocumentIntelligenceSourceSummary(), ...overrides }
}

function renderList(rows: DocumentIntelligenceSourceSummary[]) {
  const onSelectSource = vi.fn()
  const onOpenSurface = vi.fn()
  render(
    <DocumentIntelligenceSourceList
      rows={rows}
      onSelectSource={onSelectSource}
      onOpenSurface={onOpenSurface}
    />,
  )
  return { onSelectSource, onOpenSurface }
}

describe('DocumentIntelligenceSourceList | 状态显式呈现', () => {
  it('原生文档的 OCR 维度显示为「不适用」而非失败', () => {
    renderList([
      row({
        sourceKind: 'native_document',
        sourceId: 1,
        displayName: '项目章程.md',
        capabilities: {
          documentBodyReadable: true,
          markdownReadable: true,
          ocrSupportedMime: false,
          mimeType: null,
        },
        dimensionStates: {
          ocr_job: 'not_applicable',
          accepted_extraction: 'not_applicable',
          search_index: 'not_applicable',
          structured_snapshot: 'not_applicable',
          entity_link: 'not_applicable',
          governance: 'ready',
        },
      }),
    ])
    const badge = screen.getByTestId('di-dim-native_document:1-ocr_job')
    expect(badge.getAttribute('data-state')).toBe('not_applicable')
    expect(badge.textContent).toContain('不适用')
  })

  it('unavailable 维度显示为「不可用」，绝不显示为暂无/就绪', () => {
    renderList([
      row({
        sourceKind: 'attachment',
        sourceId: 2,
        dimensionStates: {
          ocr_job: 'ready',
          accepted_extraction: 'ready',
          search_index: 'empty',
          structured_snapshot: 'empty',
          entity_link: 'unavailable',
          governance: 'ready',
        },
      }),
    ])
    const badge = screen.getByTestId('di-dim-attachment:2-entity_link')
    expect(badge.getAttribute('data-state')).toBe('unavailable')
    expect(badge.textContent).toContain('不可用')
    expect(badge.textContent).not.toContain('暂无')
  })

  it('blocked 与 stale 各自可辨识', () => {
    renderList([
      row({
        sourceKind: 'attachment',
        sourceId: 3,
        dimensionStates: {
          ocr_job: 'stale',
          accepted_extraction: 'stale',
          search_index: 'blocked',
          structured_snapshot: 'empty',
          entity_link: 'empty',
          governance: 'blocked',
        },
        attentionFacets: ['stale', 'governance_blocked'],
      }),
    ])
    expect(screen.getByTestId('di-dim-attachment:3-search_index').getAttribute('data-state')).toBe(
      'blocked',
    )
    expect(screen.getByTestId('di-dim-attachment:3-ocr_job').getAttribute('data-state')).toBe(
      'stale',
    )
    expect(screen.getByTestId('di-facet-attachment:3-governance_blocked')).toBeTruthy()
  })

  it('unsupported MIME 的附件不暴露任何 OCR 入口且给出原因', () => {
    renderList([
      row({
        sourceKind: 'attachment',
        sourceId: 4,
        capabilities: {
          documentBodyReadable: false,
          markdownReadable: false,
          ocrSupportedMime: false,
          mimeType: 'application/x-legacy',
        },
        warningReasons: ['unsupported_mime'],
        entrypoints: [
          {
            surface: 'review',
            enabled: false,
            reasonCode: 'unsupported_mime',
            refs: { sourceKind: 'attachment', sourceId: 4 },
            confirmationOwnedBy: 'ocr-review-confirmation-flow',
          },
          {
            surface: 'search_index',
            enabled: false,
            reasonCode: 'unsupported_mime',
            refs: { sourceKind: 'attachment', sourceId: 4 },
            confirmationOwnedBy: 'ocr-document-search-indexing',
          },
        ],
      }),
    ])
    expect(screen.getByTestId('di-unsupported-attachment:4')).toBeTruthy()
    const review = screen.getByTestId('di-entry-attachment:4-review') as HTMLButtonElement
    expect(review.disabled).toBe(true)
    expect(review.getAttribute('title')).toContain('不支持的文件类型')
  })

  it('服务端禁用的入口不可点击，点击不会触发打开', () => {
    const { onOpenSurface } = renderList([
      row({
        sourceKind: 'attachment',
        sourceId: 5,
        entrypoints: [
          {
            surface: 'search_index',
            enabled: false,
            reasonCode: 'no_accepted_extraction',
            refs: { sourceKind: 'attachment', sourceId: 5 },
            confirmationOwnedBy: 'ocr-document-search-indexing',
          },
        ],
      }),
    ])
    const btn = screen.getByTestId('di-entry-attachment:5-search_index')
    fireEvent.click(btn)
    expect(onOpenSurface).not.toHaveBeenCalled()
  })

  it('not-started 附件：OCR 维度为「暂无」，只暴露被服务端允许的创建入口', () => {
    renderList([
      row({
        sourceKind: 'attachment',
        sourceId: 10,
        dimensionStates: {
          ocr_job: 'empty',
          accepted_extraction: 'empty',
          search_index: 'empty',
          structured_snapshot: 'empty',
          entity_link: 'empty',
          governance: 'ready',
        },
        attentionFacets: [],
        entrypoints: [
          {
            surface: 'review',
            enabled: false,
            reasonCode: 'no_accepted_extraction',
            refs: { sourceKind: 'attachment', sourceId: 10 },
            confirmationOwnedBy: 'ocr-review-confirmation-flow',
          },
          {
            surface: 'document_reader',
            enabled: true,
            reasonCode: null,
            refs: { sourceKind: 'attachment', sourceId: 10 },
            confirmationOwnedBy: 'read-only',
          },
        ],
      }),
    ])
    expect(screen.getByTestId('di-dim-attachment:10-ocr_job').getAttribute('data-state')).toBe(
      'empty',
    )
    expect(
      (screen.getByTestId('di-entry-attachment:10-review') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByTestId('di-entry-attachment:10-document_reader') as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('processing / needs_review / ready_for_downstream facet 各自可辨识', () => {
    renderList([
      row({ sourceKind: 'attachment', sourceId: 11, attentionFacets: ['processing'] }),
      row({ sourceKind: 'attachment', sourceId: 12, attentionFacets: ['needs_review'] }),
      row({ sourceKind: 'attachment', sourceId: 13, attentionFacets: ['ready_for_downstream'] }),
    ])
    expect(screen.getByTestId('di-facet-attachment:11-processing').textContent).toBe('处理中')
    expect(screen.getByTestId('di-facet-attachment:12-needs_review').textContent).toBe('待审查')
    expect(screen.getByTestId('di-facet-attachment:13-ready_for_downstream').textContent).toBe(
      '可进入下游',
    )
  })

  it('空结果与加载态各有独立提示', () => {
    const { rerender } = render(
      <DocumentIntelligenceSourceList
        rows={[]}
        isLoading
        onSelectSource={vi.fn()}
        onOpenSurface={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('正在加载')
    rerender(
      <DocumentIntelligenceSourceList rows={[]} onSelectSource={vi.fn()} onOpenSurface={vi.fn()} />,
    )
    expect(screen.getByText(/没有可显示的来源/)).toBeTruthy()
  })
})

describe('DocumentIntelligenceEvidencePanel | 低敏与降级', () => {
  it('audit restricted / retention hold / privacy blocked 显式呈现', () => {
    const detail = buildDocumentIntelligenceSourceDetail({
      auditAccess: 'restricted',
      retentionHoldActive: true,
      privacyStatus: 'blocked',
    })
    render(<DocumentIntelligenceEvidencePanel detail={detail} />)
    expect(screen.getByTestId('di-gov-audit').textContent).toBe('受限')
    expect(screen.getByTestId('di-gov-hold').textContent).toBe('进行中')
    expect(screen.getByTestId('di-gov-privacy').textContent).toBe('已阻断')
  })

  it('null 计数渲染为「不可用」，绝不显示 0', () => {
    const base = buildDocumentIntelligenceSourceDetail()
    const detail = {
      ...base,
      evidence: {
        ...base.evidence,
        downstream: {
          ...base.evidence.downstream,
          entityLinkActiveCount: null,
        },
      },
      governance: { ...base.governance, retentionHoldActive: null, retentionExpiredCount: null },
    }
    render(<DocumentIntelligenceEvidencePanel detail={detail} />)
    expect(screen.getByTestId('di-downstream-links').textContent).toBe('不可用')
    expect(screen.getByTestId('di-downstream-links').textContent).not.toBe('0')
    expect(screen.getByTestId('di-gov-hold').textContent).toBe('不可用')
  })

  it('profile 停用/无效状态可读，且不渲染 schema 正文等禁止载荷', () => {
    const base = buildDocumentIntelligenceSourceDetail()
    const detail = {
      ...base,
      profileProvenance: {
        identity: 'org.contract.v1',
        version: '3',
        provenanceKind: 'organization_owned' as const,
        status: 'disabled' as const,
        receiptRef: 'profile:7',
      },
    }
    const { container } = render(<DocumentIntelligenceEvidencePanel detail={detail} />)
    expect(screen.getByTestId('di-profile-status').textContent).toBe('已停用')
    expect(screen.getByTestId('di-profile-kind').textContent).toBe('组织自有')
    const dom = container.innerHTML
    for (const forbidden of ['Authorization', 'Bearer ', 'sk-', 'C:\\\\', '/var/lib', 'prompt']) {
      expect(dom).not.toContain(forbidden)
    }
  })
})

describe('resolvePanelMountBlock | 封闭映射与 fail closed', () => {
  it('未知 surface 一律拒绝', () => {
    expect(resolvePanelMountBlock('evil_surface', { jobId: 1, extractionId: 1 }, true)).toEqual({
      blocked: true,
      reasonCode: 'unknown_surface',
    })
  })

  it('服务端拒绝时即使 client 声称可用也不挂载', () => {
    expect(resolvePanelMountBlock('review', { jobId: 1, extractionId: null }, false)).toEqual({
      blocked: true,
      reasonCode: 'permission_denied',
    })
  })

  it('review 缺 jobId、下游缺 extractionId 均拒绝', () => {
    expect(
      resolvePanelMountBlock('review', { jobId: null, extractionId: 9 }, true)?.reasonCode,
    ).toBe('no_accepted_extraction')
    for (const surface of ['search_index', 'structured_extraction', 'entity_linking']) {
      expect(
        resolvePanelMountBlock(surface, { jobId: 3, extractionId: null }, true)?.reasonCode,
      ).toBe('no_accepted_extraction')
    }
  })

  it('上下文齐备且服务端允许时放行', () => {
    expect(resolvePanelMountBlock('review', { jobId: 3, extractionId: null }, true)).toBeNull()
    expect(
      resolvePanelMountBlock('governance', { jobId: null, extractionId: null }, true),
    ).toBeNull()
    expect(
      resolvePanelMountBlock('structured_extraction', { jobId: 3, extractionId: 9 }, true),
    ).toBeNull()
  })
})

describe('URL 状态 | round-trip 与非法参数清理', () => {
  it('筛选 + 面板选择可 round-trip', () => {
    const state = {
      attention: 'needs_review' as const,
      source: { kind: 'attachment' as const, id: 42 },
      panel: 'review' as const,
      job: 7,
      extraction: null,
    }
    const qs = serializeIntelligenceUrlState(state)
    const parsed = parseIntelligenceUrlState(Object.fromEntries(new URLSearchParams(qs)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.state).toEqual(state)
  })

  it('未知键 / 注入载荷被拒绝', () => {
    expect(parseIntelligenceUrlState({ evil: 'x' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ attention: '<script>' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ source: 'attachment:-1' }).ok).toBe(false)
    expect(parseIntelligenceUrlState({ job: 'abc' }).ok).toBe(false)
  })

  it('sanitize 丢弃非 allowlist 键并报告', () => {
    const result = sanitizeIntelligenceUrlParams({
      view: 'intelligence',
      fileName: 'secret.pdf',
      token: 'sk-live-abc',
    })
    expect(Object.keys(result.cleaned)).toEqual(['view'])
    expect(result.rejectedKeys).toEqual(expect.arrayContaining(['fileName', 'token']))
  })
})
