/**
 * SearchResultCard 组件测试
 *
 * 覆盖：
 * - 常规实体（task/file）渲染可跳转链接卡片
 * - activity 卡不可跳转 + title 提示（/projects/:id/activity 路由不存在）
 * - document 卡不可跳转 + title 提示（后端 buildSafeTarget 生成的
 *   /projects/:id/documents/:docId 路由不存在，文档详情需到项目文件库查看）
 */
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchResultCard } from '@/components/search/SearchResultCard'
import type { SearchResultItem } from '@/lib/api/search'

// next/link → 纯 <a>，避免依赖 App Router context
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

function makeItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    entityType: 'task',
    entityId: 1,
    projectId: 10,
    title: '完成里程碑验收',
    summary: '验收标准与检查清单',
    matchedFields: ['title'],
    highlights: [],
    status: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    target: '/projects/10/tasks/1',
    source: 'task',
    score: 1,
    metadata: undefined,
    ...overrides,
  }
}

describe('SearchResultCard', () => {
  test('常规实体（task）渲染可跳转链接卡片', () => {
    render(<SearchResultCard item={makeItem()} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/projects/10/tasks/1')
  })

  test('file 实体仍可跳转到文件库详情', () => {
    const item = makeItem({ entityType: 'file', target: '/projects/10/files/1' })
    render(<SearchResultCard item={item} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/projects/10/files/1')
  })

  test('activity 卡不可跳转并带 title 提示', () => {
    const item = makeItem({ entityType: 'activity', target: '/projects/10/activity?logId=1' })
    render(<SearchResultCard item={item} />)
    expect(screen.queryByRole('link')).toBeNull()
    const card = screen.getByTitle('活动记录暂无详情页可跳转，可在「审计日志」中查看')
    expect(card.tagName).toBe('DIV')
  })

  test('document 卡不可跳转并带 title 提示（文档详情请到项目文件库查看）', () => {
    const item = makeItem({
      entityType: 'document',
      target: '/projects/10/documents/1',
      title: '项目章程草案',
    })
    render(<SearchResultCard item={item} />)
    expect(screen.queryByRole('link')).toBeNull()
    const card = screen.getByTitle('文档详情请到项目文件库查看')
    expect(card.tagName).toBe('DIV')
    // 类型徽章仍显示「文档」，只是不再可点击
    expect(screen.getByText('文档')).toBeInTheDocument()
    expect(screen.getByText('项目章程草案')).toBeInTheDocument()
  })
})
