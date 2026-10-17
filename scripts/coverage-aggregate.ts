#!/usr/bin/env node
/**
 * coverage-aggregate.ts
 *
 * 聚合后端（c8 text）与前端（vitest json-summary）覆盖率报告，
 * 产出 coverage-summary.md 发布证据摘要。
 *
 * 用法：pnpm tsx scripts/coverage-aggregate.ts
 *       （在 CI coverage 阶段由 turbo 编排自动调用）
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

/* ── 路径 ─────────────────────────────────────────── */

const BACKEND_REPORT = resolve('apps/backend/coverage.txt') // c8 --reporter=text
const FRONTEND_SUMMARY = resolve('apps/frontend/coverage/coverage-summary.json') // vitest --reporter=json-summary
const OUTPUT = resolve('coverage/coverage-summary.md')

/* ── c8 text 解析 ──────────────────────────────────── */

interface C8Entry {
  file: string
  statements: number
  uncovered: string[]
}

function parseC8Text(text: string): C8Entry[] {
  const lines = text.split('\n').filter(Boolean)
  const entries: C8Entry[] = []
  let started = false

  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('---')) {
      started = true
      continue
    }
    if (!started || line.startsWith('File')) continue
    if (line === '' || line.startsWith('All files')) continue

    const parts = line.split(/\s{2,}/)
    if (parts.length < 4) continue

    const file = parts[0]
    const stmtPct = parseFloat(parts[1].replace('%', ''))
    if (isNaN(stmtPct)) continue

    entries.push({ file, statements: stmtPct, uncovered: [] })
  }
  return entries
}

/* ── vitest json-summary 解析 ───────────────────────── */

interface VitestSummary {
  total: { lines: { pct: number }; branches: { pct: number } }
}

function parseVitestSummary(path: string): VitestSummary | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as VitestSummary
  } catch {
    return null
  }
}

/* ── 分组聚合 ──────────────────────────────────────── */

const GROUPS: Record<string, RegExp[]> = {
  'Services (backend)': [/^app\/services\//],
  'Policies (backend)': [/^app\/policies\//],
  'RBAC Service (backend)': [/^app\/services\/rbac_service\.ts$/],
  'Controllers (backend)': [/^app\/controllers\//],
  'Models (backend)': [/^app\/models\//],
  'Validators (backend)': [/^app\/validators\//],
}

function summarizeC8(entries: C8Entry[]): string {
  if (entries.length === 0) return '  （无数据 — 覆盖率尚未运行）\n'

  const matched = new Set<string>()
  const lines: string[] = []

  for (const [group, patterns] of Object.entries(GROUPS)) {
    const groupEntries = entries.filter((e) => patterns.some((p) => p.test(e.file)))
    if (groupEntries.length === 0) continue
    groupEntries.forEach((e) => matched.add(e.file))

    const avg = groupEntries.reduce((s, e) => s + e.statements, 0) / groupEntries.length

    lines.push(`- **${group}** — ${groupEntries.length} 文件, 均值 ${avg.toFixed(1)}%`)

    for (const e of groupEntries) {
      const flag = e.statements < 90 ? ' ⚠️' : ''
      lines.push(`  - \`${e.file}\` — ${e.statements.toFixed(1)}%${flag}`)
    }
  }

  /* 未分组文件 */
  const unmatched = entries.filter((e) => !matched.has(e.file))
  if (unmatched.length > 0) {
    lines.push(`\n- **其他（未分组）** — ${unmatched.length} 文件`)
    for (const e of unmatched) {
      lines.push(`  - \`${e.file}\` — ${e.statements.toFixed(1)}%`)
    }
  }

  return lines.join('\n')
}

/* ── 主逻辑 ────────────────────────────────────────── */

function main() {
  const sections: string[] = ['# 覆盖率汇总报告\n', `> 生成时间: ${new Date().toISOString()}`]

  /* 后端 */
  if (existsSync(BACKEND_REPORT)) {
    const text = readFileSync(BACKEND_REPORT, 'utf-8')
    const entries = parseC8Text(text)
    sections.push('## 后端覆盖率 (c8)\n')
    sections.push(summarizeC8(entries))
  } else {
    sections.push('## 后端覆盖率 (c8)\n\n  ⚠️ 后端覆盖率报告未找到 — 尚未运行 `test:coverage`\n')
  }

  /* 前端 */
  const frontend = parseVitestSummary(FRONTEND_SUMMARY)
  sections.push('\n## 前端覆盖率 (vitest)\n')
  if (frontend) {
    sections.push(`- **语句覆盖**: ${frontend.total.lines.pct.toFixed(1)}%`)
    sections.push(`- **分支覆盖**: ${frontend.total.branches.pct.toFixed(1)}%`)
    sections.push(frontend.total.lines.pct >= 80 ? '  ✅ 全局语句 ≥80%' : '  ❌ 全局语句 <80%')
    sections.push(frontend.total.branches.pct >= 70 ? '  ✅ 全局分支 ≥70%' : '  ❌ 全局分支 <70%')
  } else {
    sections.push('  ⚠️ 前端覆盖率报告未找到 — 尚未运行 `vitest --coverage`\n')
  }

  /* GanttService 18 例占位 */
  sections.push('\n## GanttService 18 例\n')
  sections.push('> 待 SCHED/CP/CYCLE 用例补齐后登记结果\n')
  sections.push('- SCHED-001~010: ⏳ 待运行')
  sections.push('- CP-001~006: ⏳ 待运行')
  sections.push('- CYCLE (2例): ⏳ 待运行')

  /* 汇总行 */
  sections.push('\n---\n')
  sections.push('*本报告由 `scripts/coverage-aggregate.ts` 自动生成*')

  const output = sections.join('\n')

  /* 确保输出目录存在 */
  mkdirSync(dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, output, 'utf-8')
  console.log(`✅ coverage-summary.md 已写入 ${OUTPUT}`)
}

main()
