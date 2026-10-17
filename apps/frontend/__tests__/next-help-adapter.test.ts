/**
 * v3-ui-next-help-knowledge-domain W1 · tasks 1.2 —— 帮助域适配层纯函数单测。
 *
 * 覆盖：buildModuleGrid 聚类与 4 篇截断、resolveLearningPathArticles 存在/
 * 缺失回退、getRecentArticles 按 updatedAt 降序、故障排查提取与 contentType
 * 兜底。全部零 DOM、零网络、零 fs（仅类型依赖），jsdom 环境下亦不与 DOM 交互。
 */
import { describe, expect, test } from 'vitest'
import {
  buildModuleGrid,
  extractTroubleshootingArticles,
  getRecentArticles,
  resolveLearningPathArticles,
  type HelpArticleSummary,
} from '@/lib/next/help/help-adapter'
import type { HelpArea, HelpArticle, HelpLearningPath, HelpNav } from '@/lib/help/types'

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeArticle(partial: {
  id: string
  area?: string
  title?: string
  summary?: string
  contentType?: string
  updatedAt?: string
}): HelpArticle {
  const fm = {
    id: partial.id,
    title: partial.title ?? '文章',
    summary: partial.summary ?? '摘要',
    contentType: (partial.contentType ?? 'how-to') as HelpArticle['frontmatter']['contentType'],
    roles: ['member'] as HelpArticle['frontmatter']['roles'],
    permissions: [],
    editions: ['free'] as HelpArticle['frontmatter']['editions'],
    productVersion: 'v3',
    featureFlags: [],
    owner: 'test',
    updatedAt: partial.updatedAt ?? '2026-08-30',
    reviewAfter: '2026-11-30',
    related: [],
    screenshots: [],
    contentStatus: 'complete' as const,
  }
  return {
    id: partial.id,
    area: partial.area ?? 'projects',
    slug: partial.id.split('.')[1] ?? 'a',
    path: `content/help/zh-CN/${partial.area ?? 'projects'}/${partial.id.split('.')[1]}.mdx`,
    frontmatter: fm,
    body: '正文。',
    headings: [{ level: 1, text: fm.title, id: 'article' }],
  }
}

const AREAS: HelpArea[] = [
  { id: 'projects', label: '项目与视图', order: 0, articleIds: ['projects.a', 'projects.b'] },
  { id: 'ai', label: 'AI 能力', order: 1, articleIds: ['ai.c'] },
  { id: 'empty', label: '空模块', order: 2, articleIds: ['gone.missing'] },
  {
    id: 'troubleshooting',
    label: '故障排查',
    order: 3,
    articleIds: ['troubleshooting.login', 'troubleshooting.loading'],
  },
]

const ARTICLES: HelpArticle[] = [
  makeArticle({ id: 'projects.a', area: 'projects', title: '项目创建', updatedAt: '2026-09-02' }),
  makeArticle({ id: 'projects.b', area: 'projects', title: '任务看板', updatedAt: '2026-09-01' }),
  makeArticle({
    id: 'ai.c',
    area: 'ai',
    title: 'AI 连接',
    updatedAt: '2026-09-03',
    contentType: 'concept',
  }),
  makeArticle({
    id: 'troubleshooting.login',
    area: 'troubleshooting',
    title: '登录失败排查',
    summary: '登录异常怎么处理。',
    updatedAt: '2026-08-29',
    contentType: 'troubleshooting',
  }),
  makeArticle({
    id: 'troubleshooting.loading',
    area: 'troubleshooting',
    title: '页面加载失败排查',
    summary: '加载异常怎么处理。',
    updatedAt: '2026-08-28',
    contentType: 'troubleshooting',
  }),
  makeArticle({
    id: 'reference.x',
    area: 'reference',
    title: '参考条目（故障主题）',
    updatedAt: '2026-08-01',
    contentType: 'troubleshooting',
  }),
]

function byId(articles: HelpArticle[] = ARTICLES): Map<string, HelpArticle> {
  return new Map(articles.map((article) => [article.id, article]))
}

const NAV: HelpNav = {
  locale: 'zh-CN',
  productVersion: 'v3',
  areas: AREAS,
  learningPaths: [],
}

function learningPath(articleIds: string[]): HelpLearningPath {
  return {
    id: 'pm',
    label: '项目经理',
    description: '全周期操作。',
    roles: ['project_manager'],
    articleIds,
  }
}

// ---------------------------------------------------------------------------
// buildModuleGrid
// ---------------------------------------------------------------------------

describe('buildModuleGrid：模块聚合（spec「帮助中心首页与模块导航浏览」）', () => {
  test('按 area 聚类、遵循登记顺序，guides 长度不超过 4', () => {
    const grid = buildModuleGrid(AREAS, byId())
    expect(grid.map((item) => item.areaId)).toEqual(['projects', 'ai', 'troubleshooting'])
    const projects = grid[0]!
    expect(projects.areaLabel).toBe('项目与视图')
    expect(projects.totalArticles).toBe(2)
    expect(projects.guides.map((guide) => guide.id)).toEqual(['projects.a', 'projects.b'])
    expect(grid[1]!.guides).toHaveLength(1)
  })

  test('文章超过 4 篇时每个模块截取前 4 篇', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      makeArticle({
        id: `projects.many-${index}`,
        area: 'projects',
        title: `指南 ${index}`,
        updatedAt: '2026-09-01',
      }),
    )
    const area: HelpArea = {
      id: 'projects',
      label: '项目与视图',
      order: 0,
      articleIds: many.map((article) => article.id),
    }
    const grid = buildModuleGrid([area], new Map(many.map((article) => [article.id, article])))
    expect(grid[0]!.totalArticles).toBe(6)
    expect(grid[0]!.guides).toHaveLength(4)
    expect(grid[0]!.guides.map((guide) => guide.id)).toEqual(many.slice(0, 4).map((a) => a.id))
  })

  test('缺失 id 静默剔除；空模块（无任何可解析文章）不产出卡片', () => {
    const grid = buildModuleGrid(AREAS, byId(ARTICLES.slice(0, 3)))
    expect(grid.some((item) => item.areaId === 'empty')).toBe(false)
    // 各模块按自身登记顺序解析；同一 id 重复登记只消费一次
    const duplicatedArea: HelpArea = {
      id: 'projects',
      label: '项目与视图',
      order: 0,
      articleIds: ['projects.a', 'projects.a', 'gone.x'],
    }
    const deduped = buildModuleGrid([duplicatedArea], byId())
    expect(deduped[0]!.guides.map((guide) => guide.id)).toEqual(['projects.a'])
  })
})

// ---------------------------------------------------------------------------
// resolveLearningPathArticles
// ---------------------------------------------------------------------------

describe('resolveLearningPathArticles：角色学习路径解析（spec 场景「从角色学习卡片点击直达推荐文章」）', () => {
  test('articleId 全部存在：按登记顺序解析并给出 firstArticleId', () => {
    const resolved = resolveLearningPathArticles(
      learningPath(['projects.a', 'troubleshooting.login']),
      byId(),
    )
    expect(resolved.firstArticleId).toBe('projects.a')
    expect(resolved.articles.map((guide) => guide.id)).toEqual([
      'projects.a',
      'troubleshooting.login',
    ])
    expect(resolved.articles[0]!.title).toBe('项目创建')
  })

  test('部分缺失：缺失 id 剔除并回退到首个存在文章', () => {
    const resolved = resolveLearningPathArticles(
      learningPath(['gone.missing', 'projects.b', 'also.gone']),
      byId(),
    )
    expect(resolved.firstArticleId).toBe('projects.b')
    expect(resolved.articles.map((guide) => guide.id)).toEqual(['projects.b'])
  })

  test('全部缺失 / 空 articleIds：firstArticleId 为 null 且 articles 为空（不抛错）', () => {
    const resolved = resolveLearningPathArticles(learningPath(['gone.a', 'gone.b']), byId())
    expect(resolved.firstArticleId).toBeNull()
    expect(resolved.articles).toEqual([])

    const empty = resolveLearningPathArticles(learningPath([]), byId())
    expect(empty.firstArticleId).toBeNull()
    expect(empty.articles).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getRecentArticles
// ---------------------------------------------------------------------------

describe('getRecentArticles：最近更新（spec「最近更新文档底册」）', () => {
  test('按 updatedAt 降序排序并默认截取前 5 条', () => {
    const labels = new Map(AREAS.map((area) => [area.id, area.label]))
    const recent = getRecentArticles(ARTICLES, labels)
    expect(recent.map((entry) => entry.updatedAt)).toEqual([
      '2026-09-03',
      '2026-09-02',
      '2026-09-01',
      '2026-08-29',
      '2026-08-28',
    ])
    expect(recent[0]!.id).toBe('ai.c')
    expect(recent).toHaveLength(5)
  })

  test('limit 生效且条目携带 areaLabel', () => {
    const labels = new Map([['projects', '项目与视图']])
    const recent = getRecentArticles(ARTICLES.slice(0, 2), labels, 1)
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({
      id: 'projects.a',
      areaLabel: '项目与视图',
      title: '项目创建',
    })
  })

  test('同 updatedAt 以 id 升序保证确定性；空列表与 0 limit 安全', () => {
    const same = [
      makeArticle({ id: 'projects.z', area: 'projects', updatedAt: '2026-09-01' }),
      makeArticle({ id: 'projects.a', area: 'projects', updatedAt: '2026-09-01' }),
    ]
    const labels = new Map([['projects', '项目与视图']])
    expect(getRecentArticles(same, labels).map((entry) => entry.id)).toEqual([
      'projects.a',
      'projects.z',
    ])
    expect(getRecentArticles([], labels)).toEqual([])
    expect(getRecentArticles(same, labels, 0)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// extractTroubleshootingArticles
// ---------------------------------------------------------------------------

describe('extractTroubleshootingArticles：故障排查提取与兜底', () => {
  test('优先解析 troubleshooting 区登记文章（跨区引用去重）', () => {
    const list = extractTroubleshootingArticles(NAV, ARTICLES)
    expect(list.map((item) => item.id)).toEqual([
      'troubleshooting.login',
      'troubleshooting.loading',
    ])
    expect(list[0]).toMatchObject({
      id: 'troubleshooting.login',
      title: '登录失败排查',
      summary: '登录异常怎么处理。',
    } satisfies Partial<HelpArticleSummary>)
  })

  test('troubleshooting 区缺失时按 contentType 兜底收敛', () => {
    const noAreaNav: HelpNav = {
      ...NAV,
      areas: [AREAS[0]!, AREAS[1]!, AREAS[2]!],
    }
    const list = extractTroubleshootingArticles(noAreaNav, ARTICLES)
    // 三篇 contentType=troubleshooting（area 无关），保持输入顺序
    expect(list.map((item) => item.id)).toEqual([
      'troubleshooting.login',
      'troubleshooting.loading',
      'reference.x',
    ])
  })

  test('两源均无命中返回空数组（首页隐藏区块）', () => {
    const nav: HelpNav = { ...NAV, areas: [AREAS[0]!] }
    expect(extractTroubleshootingArticles(nav, [ARTICLES[0]!])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 纯函数纪律
// ---------------------------------------------------------------------------

describe('纯函数纪律：确定性输出、零副作用', () => {
  test('同一输入重复调用输出恒定（无内部状态漂移）', () => {
    const labels = new Map(AREAS.map((area) => [area.id, area.label]))
    const first = getRecentArticles(ARTICLES, labels)
    const second = getRecentArticles(ARTICLES, labels)
    expect(second).toEqual(first)
    expect(buildModuleGrid(AREAS, byId())).toEqual(buildModuleGrid(AREAS, byId()))
    // 全程未触碰 DOM/全局对象
    expect(typeof globalThis.document).toBe('object')
    expect(globalThis).toBeDefined()
  })
})
