// v3-triz-contradiction-copilot tasks 8.1 —— 后端双轨护栏测试
//
// 红线与双轨证明（D23 + design D14）：
// ① 旧轨 TRIZ 端点声明的路由名集合未被本 change 修改或删除；
// ② 既有 TRIZ 表结构（project_contradictions 等 27 张旧表）未被新增迁移 alter / drop / 修改；
// ③ 新轨路由与旧轨路由命名空间严格隔离，互不覆盖；
// ④ 负向验证：人为构造缺失旧轨路由或篡改旧表结构时，护栏判定必须失败。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@japa/runner'

const BACKEND_ROOT = process.cwd()

/** 旧轨 TRIZ 路由名全量基线清单（共 18 组 97 条路由名，冻结式只读） */
export const LEGACY_TRIZ_ROUTE_NAMES = [
  // 1. projects.triz-decision-logs
  'projects.triz-decision-logs.index',
  'projects.triz-decision-logs.subject-lookup',
  'projects.triz-decision-logs.draft-reason',
  'projects.triz-decision-logs.show',
  'projects.triz-decision-logs.store',
  'projects.triz-decision-logs.supersede',
  // 2. projects.triz-decision-center
  'projects.triz-decision-center.summary',
  'projects.triz-decision-center.items.index',
  'projects.triz-decision-center.items.show',
  'projects.triz-decision-center.readiness',
  // 3. projects.triz.delivery-loop
  'projects.triz.delivery-loop.summary',
  'projects.triz.delivery-loop.items',
  'projects.triz.delivery-loop.item-detail',
  'projects.triz.delivery-loop.item-ready',
  'projects.triz.delivery-loop.links-preview',
  'projects.triz.delivery-loop.links-confirm',
  'projects.triz.delivery-loop.verifications',
  'projects.triz.delivery-loop.reopen',
  // 4. projects.triz-ifr-visualizations
  'projects.triz-ifr-visualizations.preview',
  'projects.triz-ifr-visualizations.index',
  'projects.triz-ifr-visualizations.show',
  'projects.triz-ifr-visualizations.save',
  'projects.triz-ifr-visualizations.ai-draft',
  'projects.triz-ifr-visualizations.freshness',
  'projects.triz-ifr-visualizations.handoff-preview',
  'projects.triz-ifr-visualizations.handoff-candidate',
  // 5. projects.triz-rationale
  'projects.triz-rationale.show',
  'projects.triz-rationale.feedback',
  'projects.triz-rationale.handoff',
  // 6. projects.triz-workbench
  'projects.triz-workbench.sources',
  'projects.triz-workbench.schemes.index',
  'projects.triz-workbench.schemes.store',
  'projects.triz-workbench.schemes.show',
  'projects.triz-workbench.schemes.update',
  'projects.triz-workbench.schemes.abandon',
  'projects.triz-workbench.options.store',
  'projects.triz-workbench.options.destroy',
  'projects.triz-workbench.comparison',
  'projects.triz-workbench.narrative',
  'projects.triz-workbench.draft-handoff',
  // 7. projects.triz-resource-analyses
  'projects.triz-resource-analyses.create',
  'projects.triz-resource-analyses.index',
  'projects.triz-resource-analyses.show',
  'projects.triz-resource-analyses.resources',
  'projects.triz-resource-analyses.opportunities',
  'projects.triz-resource-analyses.explain',
  'projects.triz-resource-analyses.review',
  'projects.triz-resource-analyses.workbench-preview',
  'projects.triz-resource-analyses.decision-preview',
  'projects.triz-resource-analyses.draft-preview',
  'projects.triz-resource-analyses.resource-preview',
  // 8. projects.triz-evolution-trend-analyses
  'projects.triz-evolution-trend-analyses.create',
  'projects.triz-evolution-trend-analyses.index',
  'projects.triz-evolution-trend-analyses.show',
  'projects.triz-evolution-trend-analyses.trends',
  'projects.triz-evolution-trend-analyses.risks',
  'projects.triz-evolution-trend-analyses.history',
  'projects.triz-evolution-trend-analyses.explain',
  'projects.triz-evolution-trend-analyses.review',
  'projects.triz-evolution-trend-analyses.workbench-preview',
  'projects.triz-evolution-trend-analyses.decision-preview',
  'projects.triz-evolution-trend-analyses.draft-preview',
  'projects.triz-evolution-trend-analyses.risk-preview',
  // 9. projects.triz-skill-layer
  'projects.triz-skill-layer.summary',
  'projects.triz-skill-layer.destinations',
  'projects.triz-skill-layer.route-preview',
  'projects.triz-skill-layer.handoff-preview',
  // 10. projects.triz-pm-phase-integration
  'projects.triz-pm-phase-integration.create',
  'projects.triz-pm-phase-integration.index',
  'projects.triz-pm-phase-integration.show',
  'projects.triz-pm-phase-integration.phases',
  'projects.triz-pm-phase-integration.phase',
  'projects.triz-pm-phase-integration.review',
  'projects.triz-pm-phase-integration.explain',
  'projects.triz-pm-phase-integration.handoff-preview',
  // 11. projects.triz-assistant
  'projects.triz-assistant.runs.index',
  'projects.triz-assistant.runs.show',
  'projects.triz-assistant.submit',
  'projects.triz-assistant.feedback',
  'projects.triz-assistant.preview',
  // 12. projects.function-analysis-diagrams
  'projects.function-analysis-diagrams.create',
  'projects.function-analysis-diagrams.index',
  'projects.function-analysis-diagrams.show',
  'projects.function-analysis-diagrams.graph',
  'projects.function-analysis-diagrams.issues',
  'projects.function-analysis-diagrams.explain',
  'projects.function-analysis-diagrams.review',
  'projects.function-analysis-diagrams.workbench-preview',
  'projects.function-analysis-diagrams.decision-preview',
  'projects.function-analysis-diagrams.handoff-preview',
  // 13. projects.triz.contradiction-matrix
  'projects.triz.contradiction-matrix.show',
  'projects.triz.contradiction-matrix.handoff',
  // 14. compiler.runs.triz-analysis
  'compiler.runs.triz-analysis.index',
  'compiler.runs.triz-analysis.show',
  'compiler.runs.triz-analysis.handoff',
  // 15. api.v1.triz-pack
  'api.v1.triz-pack.health',
  'api.v1.triz-pack.contributions',
  'api.v1.triz-pack.execute',
  // 16. projects.contradictions
  'projects.contradictions.index',
  'projects.contradictions.refresh',
  'projects.contradictions.show',
  'projects.contradictions.confirm',
  'projects.contradictions.dismiss',
  'projects.contradictions.explain',
  // 17. projects.physical-contradiction-analyses
  'projects.physical-contradiction-analyses.create',
  'projects.physical-contradiction-analyses.index',
  'projects.physical-contradiction-analyses.show',
  'projects.physical-contradiction-analyses.candidates',
  'projects.physical-contradiction-analyses.explain',
  'projects.physical-contradiction-analyses.review',
  'projects.physical-contradiction-analyses.confirmation-preview',
  'projects.physical-contradiction-analyses.handoff-preview',
  // 18. projects.technical-contradiction-analyses
  'projects.technical-contradiction-analyses.create',
  'projects.technical-contradiction-analyses.index',
  'projects.technical-contradiction-analyses.show',
  'projects.technical-contradiction-analyses.candidates',
  'projects.technical-contradiction-analyses.explain',
  'projects.technical-contradiction-analyses.review',
  'projects.technical-contradiction-analyses.confirmation-preview',
  'projects.technical-contradiction-analyses.handoff-preview',
] as const

/** 本 change 新轨路由名清单（W2/W3/W4 新增） */
export const NEW_TRACK_TRIZ_ROUTE_NAMES = [
  'projects.triz-copilot.analyses.store',
  'projects.triz-copilot.analyses.index',
  'projects.triz-copilot.analyses.show',
  'projects.triz-copilot.analyses.override',
  'projects.triz-gallery-artifacts.index',
  'projects.triz-gallery-artifacts.store',
  'projects.triz-gallery-artifacts.show',
  'projects.triz-gallery-artifacts.versions',
  'projects.triz-gallery-artifacts.update',
  'projects.triz-gallery-artifacts.destroy',
  'projects.triz-gallery.matrix-principles',
  'projects.triz-gallery.prefill',
  'projects.signals.index',
  'projects.signals.dismiss',
  'projects.signals.adopt',
] as const

/** 既有 TRIZ 27 张旧表清单（冻结式只读，禁止本 change 篡改结构） */
export const LEGACY_TRIZ_TABLES = [
  'project_contradictions',
  'triz_decision_logs',
  'triz_innovation_schemes',
  'triz_physical_contradiction_analysis_runs',
  'triz_physical_contradiction_candidates',
  'triz_technical_contradiction_analysis_runs',
  'triz_technical_contradiction_candidates',
  'triz_ifr_visualizations',
  'triz_resource_analysis_runs',
  'triz_resource_analysis_items',
  'triz_resource_opportunity_candidates',
  'triz_function_analysis_runs',
  'triz_function_analysis_nodes',
  'triz_function_analysis_edges',
  'triz_function_analysis_issue_candidates',
  'triz_evolution_trend_analysis_runs',
  'triz_evolution_trend_scores',
  'triz_evolution_trend_risk_candidates',
  'triz_evolution_trend_history_snapshots',
  'triz_pm_phase_integration_runs',
  'triz_pm_phase_snapshots',
  'triz_pm_phase_actions',
  'triz_assistant_runs',
  'triz_assistant_messages',
  'triz_assistant_feedback',
  'triz_delivery_links',
  'triz_delivery_events',
] as const

/** 本 change 新增的迁移文件（3 张新表） */
export const NEW_TRACK_MIGRATION_FILES = [
  '1997000000000_create_triz_copilot_analyses_table.ts',
  '1997010000000_create_project_signals_table.ts',
  '1997020000000_create_triz_gallery_artifacts_table.ts',
] as const

/** 扫描 routes.ts 中的所有 .as('...') 路由名 */
export function extractRouteNames(routesSource: string): string[] {
  const clean = routesSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const names: string[] = []
  for (const match of clean.matchAll(/\.as\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    names.push(match[1]!)
  }
  return [...new Set(names)]
}

/** 校验必需路由集合是否被完全包含，返回缺失列表 */
export function verifyRequiredRoutes(
  presentRoutes: readonly string[],
  requiredRoutes: readonly string[],
): string[] {
  const set = new Set(presentRoutes)
  return requiredRoutes.filter((name) => !set.has(name))
}

/** 检查迁移源码中是否有针对旧表的 alter / drop 等违规结构变更 */
export function scanMigrationForLegacyTableTampering(
  migrationSource: string,
  legacyTables: readonly string[],
): string[] {
  const clean = migrationSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const violations: string[] = []

  for (const table of legacyTables) {
    const alterPattern = new RegExp(`\\.alterTable\\(\\s*['"]${table}['"]`, 'i')
    const dropPattern = new RegExp(`\\.dropTable(IfExists)?\\(\\s*['"]${table}['"]`, 'i')
    const renamePattern = new RegExp(`\\.renameTable\\(\\s*['"]${table}['"]`, 'i')
    const tableRefPattern = new RegExp(`['"]${table}['"]`, 'i')

    if (alterPattern.test(clean)) {
      violations.push(`ALTER_TABLE: ${table}`)
    }
    if (dropPattern.test(clean)) {
      violations.push(`DROP_TABLE: ${table}`)
    }
    if (renamePattern.test(clean)) {
      violations.push(`RENAME_TABLE: ${table}`)
    }
    // 若在非说明文本中直接引用了旧表名
    if (tableRefPattern.test(clean) && !violations.some((v) => v.includes(table))) {
      violations.push(`REFERENCED_TABLE: ${table}`)
    }
  }

  return violations
}

test.group('双轨护栏 ① 旧轨 TRIZ 路由完整性与隔离', () => {
  const routesFile = join(BACKEND_ROOT, 'start/routes.ts')
  const routesContent = readFileSync(routesFile, 'utf8')
  const presentRoutes = extractRouteNames(routesContent)

  test('旧轨 120 项 TRIZ 路由声明全量存续，未被删除或改名', ({ assert }) => {
    const missing = verifyRequiredRoutes(presentRoutes, LEGACY_TRIZ_ROUTE_NAMES)
    assert.deepEqual(missing, [], `检测到旧轨 TRIZ 路由缺失或被意外修改：${missing.join(', ')}`)
    assert.equal(LEGACY_TRIZ_ROUTE_NAMES.length, 120, '旧轨 TRIZ 路由基线计数必须恒为 120 条')
  })

  test('新轨路由全量声明且与旧轨路由严格无交集', ({ assert }) => {
    const missingNew = verifyRequiredRoutes(presentRoutes, NEW_TRACK_TRIZ_ROUTE_NAMES)
    assert.deepEqual(missingNew, [], `新轨路由声明缺失：${missingNew.join(', ')}`)

    const overlap = NEW_TRACK_TRIZ_ROUTE_NAMES.filter((name) =>
      (LEGACY_TRIZ_ROUTE_NAMES as readonly string[]).includes(name),
    )
    assert.deepEqual(overlap, [], `新旧轨路由发生命名重叠违规：${overlap.join(', ')}`)
  })

  test('负向验证：人为缺失旧轨路由或命名冲突时护栏失败', ({ assert }) => {
    const mockRoutes = ['projects.triz-decision-logs.index', 'other.route']
    const missing = verifyRequiredRoutes(mockRoutes, LEGACY_TRIZ_ROUTE_NAMES)
    assert.isAbove(missing.length, 0, '缺失旧轨路由时必须检测出缺失')
    assert.include(missing, 'projects.contradictions.index')

    const sabotagedRoutes = [...presentRoutes].filter((r) => r !== 'projects.contradictions.index')
    const missingSabotaged = verifyRequiredRoutes(sabotagedRoutes, LEGACY_TRIZ_ROUTE_NAMES)
    assert.deepEqual(missingSabotaged, ['projects.contradictions.index'])
  })
})

test.group('双轨护栏 ② 旧轨 TRIZ 数据表结构未被本 change 修改', () => {
  const migrationsDir = join(BACKEND_ROOT, 'database/migrations')
  const allMigrationFiles = readdirSync(migrationsDir)

  // 1997 系列编号后来也被其他 change 合法使用（平台 AI 控制、AI 实验表等），
  // 「恰好 3 个」会随新功能误报。护栏真正要守的是：本 change 的 3 个迁移都在，
  // 且同系列任何迁移都不得触碰旧轨 TRIZ 表。
  test('本 change 的 3 个新表迁移均存在，且同系列其他迁移不触碰旧轨 TRIZ 表', ({ assert }) => {
    const seriesMigrations = allMigrationFiles.filter((f) => f.startsWith('1997'))
    for (const file of NEW_TRACK_MIGRATION_FILES) {
      assert.include(seriesMigrations, file, `缺少本 change 迁移 ${file}`)
    }
    for (const file of seriesMigrations) {
      const content = readFileSync(join(migrationsDir, file), 'utf8')
      const violations = scanMigrationForLegacyTableTampering(content, LEGACY_TRIZ_TABLES)
      assert.deepEqual(violations, [], `迁移 ${file} 触碰了旧轨 TRIZ 表：${violations.join(', ')}`)
    }
  })

  test('本 change 新增迁移未 alter/drop/引用任何旧轨 TRIZ 数据表', ({ assert }) => {
    for (const file of NEW_TRACK_MIGRATION_FILES) {
      const filePath = join(migrationsDir, file)
      const content = readFileSync(filePath, 'utf8')
      const violations = scanMigrationForLegacyTableTampering(content, LEGACY_TRIZ_TABLES)
      assert.deepEqual(
        violations,
        [],
        `迁移 ${file} 违规触碰了既有 TRIZ 旧表：${violations.join(', ')}`,
      )
    }
  })

  test('负向验证：人为在迁移中注入 alterTable / dropTable 时护栏失败', ({ assert }) => {
    const injectedAlter = `
      export default class extends BaseSchema {
        async up() {
          this.schema.alterTable('project_contradictions', (table) => {
            table.string('rogue_column')
          })
        }
      }
    `
    const violationsAlter = scanMigrationForLegacyTableTampering(injectedAlter, LEGACY_TRIZ_TABLES)
    assert.include(violationsAlter, 'ALTER_TABLE: project_contradictions')

    const injectedDrop = `
      export default class extends BaseSchema {
        async up() {
          this.schema.dropTable('triz_decision_logs')
        }
      }
    `
    const violationsDrop = scanMigrationForLegacyTableTampering(injectedDrop, LEGACY_TRIZ_TABLES)
    assert.include(violationsDrop, 'DROP_TABLE: triz_decision_logs')
  })
})
