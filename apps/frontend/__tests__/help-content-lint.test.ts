/**
 * 帮助内容 lint 单元测试（v3-help-and-operational-issues-center 1.1/1.4）。
 *
 * 通过临时目录构造真实文件树验证各检查项；覆盖 broken-link 与 staleness
 * 「门禁会失败」的证明（1.4）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lintContent, type ContentLintIssue } from '@/lib/help/lint'

const TODAY = '2026-09-01'
const FUTURE_REVIEW = '2026-11-30'

function nav(articles: string[]): string {
  const ids = articles.map((a) => `      - ${a}`).join('\n')
  return `locale: zh-CN
productVersion: v3
areas:
  - id: demo
    label: 演示
    articleIds:
${ids}
learningPaths: []
`
}

const LINT_CONFIG = `allowedExternalHosts: []
staleUpdatedAtDays: 200
forbiddenTerms:
  - "internal-note:"
  - "BEGIN SECRET"
`

function fm(overrides: Record<string, string> = {}): string {
  const merged: Record<string, string> = {
    id: 'demo.a',
    title: '演示文章',
    summary: '演示摘要。',
    contentType: 'how-to',
    roles: '[member]',
    permissions: '[]',
    editions: '[free]',
    productVersion: 'v3',
    featureFlags: '[]',
    owner: 'test',
    updatedAt: '2026-08-30',
    reviewAfter: FUTURE_REVIEW,
    related: '[]',
    screenshots: '[]',
    contentStatus: 'complete',
    ...overrides,
  }
  const frontmatter = Object.entries(merged)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return `---
${frontmatter}
---

# 演示文章

正文。

## 操作步骤

1. 第一步。

## 验证结果

成功。

## 常见问题

无。

## 下一步

- 下一步说明。
`
}

let dirs: string[] = []

function makeDir(files: Array<{ path: string; content: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'help-lint-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'lint-config.yaml'), LINT_CONFIG)
  const locale = join(dir, 'zh-CN')
  mkdirSync(locale, { recursive: true })
  writeFileSync(join(locale, 'navigation.yaml'), nav(['demo.a']))
  mkdirSync(join(locale, 'demo'), { recursive: true })
  for (const f of files) {
    const path = join(locale, f.path)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, f.content)
  }
  return locale
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})

function codes(issues: ContentLintIssue[]): string[] {
  return issues.map((i) => i.code)
}

describe('help-content-lint', () => {
  it('合法内容零 error', () => {
    const dir = makeDir([{ path: 'demo/a.mdx', content: fm() }])
    const issues = lintContent(dir, { today: TODAY })
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('broken internal link 报 error（broken-link CI 门禁）', () => {
    const content = fm().replace('## 下一步', '[坏链接](/help/articles/demo.missing)\n\n## 下一步')
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('link.broken-internal')
  })

  it('reviewAfter 过期报 error（staleness 门禁会失败）', () => {
    const content = fm({ reviewAfter: '2026-01-01', updatedAt: '2026-01-01' })
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('stale.review-overdue')
  })

  it('updatedAt 过旧报 warning', () => {
    const content = fm({ updatedAt: '2024-01-01' })
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('stale.updated-old')
  })

  it('orphan 文章警告 + 导航引用缺失文章报 error', () => {
    const dir = makeDir([
      { path: 'demo/a.mdx', content: fm() },
      { path: 'demo/b.mdx', content: fm({ id: 'demo.b', contentStatus: 'skeleton' }) },
    ])
    writeFileSync(join(dir, 'navigation.yaml'), nav(['demo.a', 'demo.ghost']))
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('orphan.article')
    expect(codes(issues)).toContain('orphan.nav-missing')
  })

  it('heading 跳级报 warning', () => {
    const content = fm().replace('## 验证结果', '#### 四层小节')
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('heading.skip-level')
  })

  it('complete how-to 缺少固定结构报 error', () => {
    const content = fm().replace('## 验证结果\n\n成功。\n', '')
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('sections.missing')
  })

  it('截图资源缺失与图片缺 alt 报 error', () => {
    const content = fm({ screenshots: '[assets/missing.png]' }).replace(
      '## 操作步骤',
      '![](assets/also-missing.png)\n\n## 操作步骤',
    )
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('frontmatter.screenshot-missing')
    expect(codes(issues)).toContain('image.missing')
    expect(codes(issues)).toContain('image.alt-missing')
  })

  it('禁用词（内部注记/secret）报 error', () => {
    const content = fm().replace('正文。', 'internal-note: 仅内部可见\n\nBEGIN SECRET abc')
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('content.forbidden-term')
  })

  it('重复文章 id 报 error', () => {
    const dir = makeDir([
      { path: 'demo/a.mdx', content: fm() },
      { path: 'demo/c.mdx', content: fm({ id: 'demo.a' }) },
    ])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('frontmatter.duplicate-id')
  })

  it('updatedAt 晚于 reviewAfter 报 error', () => {
    const content = fm({ reviewAfter: '2026-07-01' })
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('frontmatter.date-order')
  })

  it('id 与 area.slug 不一致报 error', () => {
    const content = fm({ id: 'other.area' })
    const dir = makeDir([{ path: 'demo/a.mdx', content }])
    const issues = lintContent(dir, { today: TODAY })
    expect(codes(issues)).toContain('frontmatter.id-mismatch')
  })
})
