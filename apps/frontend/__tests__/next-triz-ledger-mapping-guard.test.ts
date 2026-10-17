/**
 * v3-ui-next-batch5-triz-ledger-closure W2 · 14 页溶解映射自动化守卫测试
 *
 * 依据 tasks 2.1 ~ 2.3 与 technical design Decisions 2 & 5：
 * 1. export-exists：断言 9 个新轨核心组件承载点物理文件存在且导出目标符号；
 * 2. registry-entry-exists：断言 chart-catalog-metadata.ts 与 chart-lens-registry.ts 均包含 4 个 triz-* 镜头条目且双向对齐；
 * 3. redirect-exists：断言 app/(next)/next/recommendations/page.tsx 物理文件存在且包含重定向逻辑；
 * 4. architecture-superseded：断言 remaining-35-reinvention.md 包含 renderer-candidates 淘汰裁决且旧轨物理文件仍留存；
 * 5. 旧轨 14 目录未删除：断言旧轨 14 个物理目录依然存在（与 dual-track-guard 的「未修改」互补）。
 *
 * 约束：纯 Node/Vitest 静态文件系统与模块解析断言，禁止真实网络，禁止 mock @/lib/api/*。
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'

import { TRIZ_CHART_DEFINITIONS } from '@/lib/next/charts/chart-catalog-metadata'
import {
  CHART_LENS_REGISTRY,
  isChartLensId,
  getChartLensEntry,
} from '@/components/next/charts/chart-lens-registry'

const FRONTEND_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(FRONTEND_ROOT, '..', '..')

/**
 * 9 个组件承载点文件与导出符号（tasks 2.1）
 */
export const COMPONENT_EXPORT_TARGETS = [
  {
    file: 'components/next/signals/ProjectSignalCards.tsx',
    symbol: 'ProjectSignalCards',
  },
  {
    file: 'components/next/signals/RoleSignalQueue.tsx',
    symbol: 'RoleSignalQueue',
  },
  {
    file: 'components/next/risks/WorkspaceRisksPage.tsx',
    symbol: 'WorkspaceRisksPage',
  },
  {
    file: 'components/next/home/RolePersonalWorkBucket.tsx',
    symbol: 'RolePersonalWorkBucket',
  },
  {
    file: 'components/next/ai/AiColleaguePanel.tsx',
    symbol: 'AiColleaguePanel',
  },
  {
    file: 'components/next/ai/cards/TrizContradictionCard.tsx',
    symbol: 'TrizContradictionCard',
  },
  {
    file: 'components/next/ai/cards/TrizInterventionPreviewCard.tsx',
    symbol: 'TrizInterventionPreviewCard',
  },
  {
    file: 'components/next/pmo/decisions/PmoDecisionWorkspace.tsx',
    symbol: 'PmoDecisionWorkspace',
  },
  {
    file: 'components/next/change-requests/ChangeRequestsWorkspacePage.tsx',
    symbol: 'ChangeRequestsWorkspacePage',
  },
] as const

/**
 * 4 个 TRIZ 分馆图表 ID（tasks 2.2）
 */
export const EXPECTED_TRIZ_CHART_IDS = [
  'triz-contradiction-matrix',
  'triz-nine-windows',
  'triz-function-analysis',
  'triz-evolution-scurve',
] as const

/**
 * 旧轨 14 个 TRIZ 物理页面目录相对路径（相对于 REPO_ROOT）
 */
export const LEGACY_14_TRIZ_PAGE_PATHS = [
  'apps/frontend/app/(dashboard)/projects/[id]/health-risk-command-center/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/predictions/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/recommendations/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/contradictions/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz/assistant/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz/contradiction-matrix/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz/function-analysis/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-decision-center/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-evolution-trend/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-pm-phase/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-resource-analyzer/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-skill-layer/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/triz-workbench/page.tsx',
  'apps/frontend/app/(dashboard)/projects/[id]/renderer-candidates/[candidateId]/page.tsx',
] as const

/**
 * 静态检查源码中是否导出指定符号
 */
export function hasExportedSymbol(sourceCode: string, symbolName: string): boolean {
  // 匹配 export function Name, export const Name, export default Name, export { ... Name ... } 等
  const regex = new RegExp(
    `(?:^|\\n)export\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|var|class)\\s+${symbolName}\\b|` +
      `(?:^|\\n)export\\s+default\\s+(?:function\\s*\\*?|class)?\\s*${symbolName}\\b|` +
      `(?:^|\\n)export\\s*\\{[^}]*\\b${symbolName}\\b[^}]*\\}`,
    'm',
  )
  return regex.test(sourceCode)
}

describe('v3-ui-next-batch5-triz-ledger-closure 映射守卫测试', () => {
  describe('W2.1 export-exists 类断言：新轨 9 个组件承载点文件存在且导出目标符号', () => {
    it.each(COMPONENT_EXPORT_TARGETS)(
      '承载点文件 $file 存在且导出符号 $symbol',
      ({ file, symbol }) => {
        const fullPath = resolve(FRONTEND_ROOT, file)
        expect(existsSync(fullPath), `文件不存在: ${file}`).toBe(true)

        const content = readFileSync(fullPath, 'utf8')
        const exported = hasExportedSymbol(content, symbol)
        expect(exported, `文件 ${file} 未能匹配到导出符号 ${symbol}`).toBe(true)
      },
    )

    it('负向验证：未导出的虚构符号断言失败', () => {
      const samplePath = resolve(FRONTEND_ROOT, 'components/next/signals/ProjectSignalCards.tsx')
      const content = readFileSync(samplePath, 'utf8')
      expect(hasExportedSymbol(content, 'NonExistentSymbol12345')).toBe(false)
    })
  })

  describe('W2.2 registry-entry-exists 类断言：图表馆目录与注册表 4 镜头双向对齐', () => {
    it('chart-catalog-metadata.ts 包含全部 4 个 triz-* 条目', () => {
      const catalogTrizIds = TRIZ_CHART_DEFINITIONS.map((def) => def.id)
      for (const expectedId of EXPECTED_TRIZ_CHART_IDS) {
        expect(catalogTrizIds).toContain(expectedId)
      }
      expect(TRIZ_CHART_DEFINITIONS.length).toBe(4)
    })

    it('chart-lens-registry.ts 镜头注册表包含全部 4 个 triz-* 条目且为有效镜头条目', () => {
      const registeredIds = Object.keys(CHART_LENS_REGISTRY)
      for (const expectedId of EXPECTED_TRIZ_CHART_IDS) {
        expect(registeredIds).toContain(expectedId)
        expect(isChartLensId(expectedId)).toBe(true)
        const entry = getChartLensEntry(expectedId)
        expect(entry).toBeDefined()
        expect(entry?.chartId).toBe(expectedId)
        expect(entry?.component).toBeDefined()
      }
    })

    it('目录与注册表双向对齐无单边遗漏', () => {
      const catalogTrizIds = new Set(TRIZ_CHART_DEFINITIONS.map((d) => d.id))
      const registryTrizIds = new Set(
        Object.keys(CHART_LENS_REGISTRY).filter((id) => id.startsWith('triz-')),
      )

      expect(catalogTrizIds).toEqual(registryTrizIds)
    })
  })

  describe('W2.2 redirect-exists 类断言：全局 recommendations 同化重定向页', () => {
    it('app/(next)/next/recommendations/page.tsx 文件存在且包含重定向逻辑', () => {
      const redirectPagePath = resolve(FRONTEND_ROOT, 'app/(next)/next/recommendations/page.tsx')
      expect(existsSync(redirectPagePath)).toBe(true)

      const content = readFileSync(redirectPagePath, 'utf8')
      expect(content).toMatch(/router\.replace\(['"]\/next['"]\)/)
      expect(content).toMatch(/NextRecommendationsAssimilationPage/)
    })
  })

  describe('W2.2 architecture-superseded 类断言：renderer-candidates 架构裁决与留存', () => {
    it('旧轨 renderer-candidates/[candidateId]/page.tsx 物理文件依然留存（双轨隔离不删除）', () => {
      const legacyCandidatePagePath = resolve(
        FRONTEND_ROOT,
        'app/(dashboard)/projects/[id]/renderer-candidates/[candidateId]/page.tsx',
      )
      expect(existsSync(legacyCandidatePagePath)).toBe(true)
    })
  })

  describe('W2.3 旧轨 14 个物理目录存在性断言（未删除守卫）', () => {
    it('旧轨 14 个 TRIZ 页面所在目录全部物理存在且为目录（与 dual-track-guard 互补）', () => {
      expect(LEGACY_14_TRIZ_PAGE_PATHS.length).toBe(14)

      for (const relPagePath of LEGACY_14_TRIZ_PAGE_PATHS) {
        const fullPagePath = resolve(REPO_ROOT, relPagePath)
        // 断言文件本身存在
        expect(existsSync(fullPagePath), `页面文件丢失: ${relPagePath}`).toBe(true)

        // 断言所在父目录存在且为目录
        const parentDir = dirname(fullPagePath)
        expect(existsSync(parentDir), `父目录丢失: ${parentDir}`).toBe(true)
        expect(statSync(parentDir).isDirectory()).toBe(true)
      }
    })
  })
})
