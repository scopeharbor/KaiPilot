/**
 * 帮助中心搜索单元测试（v3-help-and-operational-issues-center 1.2）。
 * 覆盖：分词、排序加权、角色/模块/内容类型筛选、空结果建议、关键词加权、同义词扩展。
 */
import { describe, it, expect } from 'vitest'
import { tokenizeText, buildSearchIndex, searchHelp } from '@/lib/help/search'
import type { HelpArticle, HelpLearningPath } from '@/lib/help/types'

function article(partial: {
  id: string
  body?: string
  frontmatter?: Partial<HelpArticle['frontmatter']>
}): HelpArticle {
  const fm = partial.frontmatter ?? {}
  const slug = partial.id.split('.')[1] ?? 'a'
  return {
    id: partial.id,
    area: 'demo',
    slug,
    path: `content/help/zh-CN/demo/${slug}.mdx`,
    frontmatter: {
      id: partial.id,
      title: fm.title ?? '文章',
      summary: fm.summary ?? '摘要',
      contentType: fm.contentType ?? 'how-to',
      roles: fm.roles ?? ['member'],
      permissions: [],
      editions: ['free'],
      productVersion: 'v3',
      featureFlags: [],
      owner: 'test',
      updatedAt: '2026-08-30',
      reviewAfter: '2026-11-30',
      related: [],
      screenshots: [],
      contentStatus: 'complete',
      ...fm,
    },
    body: partial.body ?? '正文内容。',
    headings: [
      { level: 1, text: fm.title ?? '文章', id: 'article' },
      { level: 2, text: '操作步骤', id: 'steps' },
    ],
  }
}

const PATHS: HelpLearningPath[] = []

describe('help-search', () => {
  it('中文二元组分词：报表 → 报表；甘特图 → 甘特/特图/甘特图', () => {
    expect(tokenizeText('报表')).toEqual(['报表'])
    expect(tokenizeText('甘特图')).toEqual(['甘特', '特图', '甘特图'])
    expect(tokenizeText('gantt')).toEqual(['gantt'])
  })

  it('标题命中排名高于正文命中', () => {
    const docs = buildSearchIndex(
      [
        article({
          id: 'demo.title-hit',
          frontmatter: { title: '如何配置报表导出' },
          body: '无关正文。',
        }),
        article({
          id: 'demo.body-hit',
          frontmatter: { title: '其他文章' },
          body: '这里提到了报表导出配置。',
        }),
      ],
      PATHS,
    )
    const res = searchHelp(docs, '报表')
    expect(res.hits[0]!.articleId).toBe('demo.title-hit')
    expect(res.hits.length).toBeGreaterThanOrEqual(2)
  })

  it('关键词加权提升排名', () => {
    const docs = buildSearchIndex(
      [
        article({
          id: 'demo.kw',
          frontmatter: { title: '普通标题', summary: '普通摘要', keywords: ['ocr', '识别'] },
        }),
        article({ id: 'demo.nokw', frontmatter: { title: '普通标题', summary: '普通摘要' } }),
      ],
      PATHS,
    )
    const res = searchHelp(docs, 'ocr')
    expect(res.hits[0]!.articleId).toBe('demo.kw')
  })

  it('角色/模块/内容类型筛选', () => {
    const docs = buildSearchIndex(
      [
        article({
          id: 'demo.a',
          frontmatter: { roles: ['project_manager'], contentType: 'how-to' },
        }),
        article({ id: 'demo.b', frontmatter: { roles: ['org_admin'], contentType: 'reference' } }),
      ],
      PATHS,
    )
    const byRole = searchHelp(docs, '文章', { role: 'org_admin' })
    expect(byRole.hits.map((h) => h.articleId)).toEqual(['demo.b'])
    const byModule = searchHelp(docs, '文章', { module: 'demo' })
    expect(byModule.total).toBe(2)
    const byType = searchHelp(docs, '文章', { contentType: 'reference' })
    expect(byType.hits.map((h) => h.articleId)).toEqual(['demo.b'])
  })

  it('空结果给出建议而非静默空白', () => {
    const docs = buildSearchIndex(
      [article({ id: 'demo.a', frontmatter: { title: '甘特图使用' }, body: '正文。' })],
      PATHS,
    )
    const res = searchHelp(docs, '完全不存在的词')
    expect(res.total).toBe(0)
    expect(res.suggestions.length).toBeGreaterThan(0)
  })

  it('同义词扩展：报表 → reports', () => {
    const docs = buildSearchIndex(
      [
        article({
          id: 'demo.a',
          frontmatter: { title: 'Reports 报告中心', summary: '导出 reports' },
          body: '。',
        }),
      ],
      PATHS,
    )
    const res = searchHelp(docs, '报表')
    expect(res.total).toBeGreaterThan(0)
  })

  it('空查询返回空结果', () => {
    const docs = buildSearchIndex([article({ id: 'demo.a' })], PATHS)
    expect(searchHelp(docs, '   ').total).toBe(0)
  })
})
