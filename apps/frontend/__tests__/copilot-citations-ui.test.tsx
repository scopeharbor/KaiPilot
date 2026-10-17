import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CopilotCitationFooter } from '@/components/ai-copilot/copilot-citation-footer'
import { CopilotSourceTypeBadge } from '@/components/ai-copilot/copilot-source-type-badge'
import { CopilotExternalLink } from '@/components/ai-copilot/copilot-external-link'
import { makeCitationWithProvenance, makeCitationRender, makeCitationDrifted } from '@aiproj/types'

describe('CopilotCitationFooter', () => {
  it('renders footnote list with citation titles', () => {
    const citations = [
      makeCitationRender(makeCitationWithProvenance({ title: '测试来源A', citationId: 'cit-a' }), {
        footNoteIndex: 1,
      }),
      makeCitationRender(
        makeCitationWithProvenance({
          title: '测试来源B',
          url: 'https://other.com',
          citationId: 'cit-b',
        }),
        { footNoteIndex: 2 },
      ),
    ]
    render(<CopilotCitationFooter citations={citations} />)
    expect(screen.getByText('测试来源A')).toBeTruthy()
    expect(screen.getByText('测试来源B')).toBeTruthy()
  })

  it('shows drift indicator when snapshot differs', () => {
    const citations = [
      makeCitationRender(makeCitationDrifted(), { footNoteIndex: 1, isDrifted: true }),
    ]
    render(<CopilotCitationFooter citations={citations} />)
    expect(screen.getByText('此来源已更新')).toBeTruthy()
  })

  it('does not show drift indicator when snapshot matches', () => {
    const citations = [
      makeCitationRender(makeCitationWithProvenance(), { footNoteIndex: 1, isDrifted: false }),
    ]
    render(<CopilotCitationFooter citations={citations} />)
    expect(screen.queryByText('此来源已更新')).toBeNull()
  })

  it('links open in new window with noopener', () => {
    const citations = [makeCitationRender(makeCitationWithProvenance(), { footNoteIndex: 1 })]
    render(<CopilotCitationFooter citations={citations} />)
    const link = screen.getByText('行业标准工期分析').closest('a')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toContain('noopener')
  })

  it('returns null when no citations', () => {
    const { container } = render(<CopilotCitationFooter citations={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('CopilotSourceTypeBadge', () => {
  it('renders internal source with correct label', () => {
    render(<CopilotSourceTypeBadge provenance="internal" />)
    expect(screen.getByText('项目数据')).toBeTruthy()
  })

  it('renders external source with correct label', () => {
    render(<CopilotSourceTypeBadge provenance="external" />)
    expect(screen.getByText('外部来源')).toBeTruthy()
  })

  it('allows custom label override', () => {
    render(<CopilotSourceTypeBadge provenance="external" label="自定义标签" />)
    expect(screen.getByText('自定义标签')).toBeTruthy()
  })

  it('has non-dismissible attribute (always visible)', () => {
    render(<CopilotSourceTypeBadge provenance="external" />)
    const badge = screen.getByRole('status')
    expect(badge).toBeTruthy()
  })

  it('has aria-label for screen readers', () => {
    render(<CopilotSourceTypeBadge provenance="external" />)
    const badge = screen.getByRole('status')
    expect(badge.getAttribute('aria-label')).toContain('外部来源')
  })

  it('distinction is structural (different provenance values)', () => {
    const { rerender } = render(<CopilotSourceTypeBadge provenance="internal" />)
    expect(screen.getByText('项目数据')).toBeTruthy()
    rerender(<CopilotSourceTypeBadge provenance="external" />)
    expect(screen.getByText('外部来源')).toBeTruthy()
  })
})

describe('CopilotExternalLink', () => {
  it('renders with target=_blank and rel=noopener', () => {
    render(<CopilotExternalLink href="https://example.com">Test Link</CopilotExternalLink>)
    const link = screen.getByText('Test Link')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('does not render iframe', () => {
    const { container } = render(
      <CopilotExternalLink href="https://example.com">Test</CopilotExternalLink>,
    )
    expect(container.querySelector('iframe')).toBeNull()
  })
})
