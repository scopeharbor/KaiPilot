import { loadArticlesCached, resolveHelpContentDir } from '@/lib/help/load'
import {
  buildModuleGrid,
  extractTroubleshootingArticles,
  getRecentArticles,
  resolveLearningPathArticles,
} from '@/lib/next/help/help-adapter'
import { HelpHomeWorkspace } from '@/components/next/help/HelpHomeWorkspace'

/**
 * 新轨帮助中心首页（/next/help，v3-ui-next-help-knowledge-domain W1 · tasks 1.3，
 * spec「帮助中心首页与模块导航浏览」）。
 *
 * - 服务端组件（RSC）：服务端直接调用 `loadArticlesCached` 解析本地 Markdown
 *   内容树，毫秒级直出（Design D3「Server-side Markdown 缓存树」）；
 * - 分类聚合/排序等派生全部经 `lib/next/help/help-adapter` 纯函数计算，
 *   仅向客户端工作区传轻量投影（模块网格 ≤4 篇、学习路径、最近更新、故障排查）；
 * - 登录全员可见、零 RBAC 判断；帮助内容随产品发布，无组织数据。
 */
export default function NextHelpHomePage() {
  const { articles, nav } = loadArticlesCached(resolveHelpContentDir())
  const byId = new Map(articles.map((article) => [article.id, article]))

  return (
    <HelpHomeWorkspace
      productVersion={nav.productVersion}
      moduleGrid={buildModuleGrid(nav.areas, byId)}
      learningPaths={nav.learningPaths.map((path) => resolveLearningPathArticles(path, byId))}
      troubleshooting={extractTroubleshootingArticles(nav, articles)}
      recent={getRecentArticles(articles, new Map(nav.areas.map((area) => [area.id, area.label])))}
    />
  )
}
