/**
 * Markdown 同源导出测试（v3-help-and-operational-issues-center 1.3）。
 *
 * 验证网页渲染与「复制 Markdown / Agent 读取」来自同一正文：
 * - export 包含标题/版本/更新时间，不含导航 chrome、frontmatter 原文、内部注释、原始路径；
 * - HTML 注释被剥离；正文与 load 的 body 一致。
 */
import { describe, it, expect } from 'vitest'
import {
  parseArticleFile,
  extractHeadings,
  agentExportMarkdown,
  stripHtmlComments,
} from '@/lib/help/load'
import type { HelpArticle } from '@/lib/help/types'

const RAW = `---
id: demo.a
title: 演示文章
summary: 演示摘要。
contentType: how-to
roles: [member]
permissions: []
editions: [free]
productVersion: v3
featureFlags: []
owner: test
updatedAt: 2026-08-30
reviewAfter: 2026-11-30
related: []
screenshots: []
contentStatus: complete
---

# 演示文章

正文第一行。

<!-- internal-note: 仅内部可见，Agent 不得看到 -->

## 操作步骤

1. 第一步。
`

const article: HelpArticle = parseArticleFile('demo', 'a', RAW, 'content/help/zh-CN/demo/a.mdx')

describe('help markdown export', () => {
  it('导出正文与网页渲染同一 body（同源）', () => {
    expect(article.body).toContain('正文第一行。')
    expect(article.body).toContain('## 操作步骤')
  })

  it('导出包含标题/版本/更新时间，无 frontmatter 原文', () => {
    const out = agentExportMarkdown(article)
    expect(out).toContain('# 演示文章')
    expect(out).toContain('v3')
    expect(out).toContain('2026-08-30')
    expect(out).not.toContain('---')
    expect(out).not.toContain('frontmatter')
  })

  it('导出剥离 HTML 注释（内部注释不泄露）', () => {
    const out = agentExportMarkdown(article)
    expect(out).not.toContain('internal-note')
    expect(out).not.toContain('<!--')
    expect(stripHtmlComments('a<!-- x -->b')).toBe('ab')
  })

  it('导出无导航 chrome 与原始磁盘路径', () => {
    const out = agentExportMarkdown(article)
    expect(out).not.toContain('a.mdx')
    expect(out).not.toContain('content/help')
    expect(out).not.toContain('复制 Markdown')
    expect(out).not.toContain('sidebar')
  })

  it('heading 提取生成稳定锚点 id', () => {
    const headings = extractHeadings('## 操作步骤\n### 常见问题 A\n### 常见问题 A\n')
    expect(headings[0]).toEqual({ level: 2, text: '操作步骤', id: '操作步骤' })
    expect(headings[1]!.id).toBe('常见问题-a')
    expect(headings[2]!.id).toBe('常见问题-a-2')
  })
})
