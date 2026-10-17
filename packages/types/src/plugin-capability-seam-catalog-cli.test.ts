/**
 * plugin-capability-seam-catalog-cli —— 本机 checker 的 fixture 级测试（tasks 5.2/5.4）。
 *
 * 覆盖：clean pass / degraded cataloged evidence（exit 0）、duplicate/family gap、core redline、
 * stale host-ready、敏感输入 redaction、未知参数/坏 fixture（exit 2）、输出文件 schema、
 * 两次运行与重排输入稳定性（digest/顺序/text/JSON/退出码）。
 * 纯本地：fixture 读取 + 本机仓库路径存在性，零网络/零真实 provider。
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PLUGIN_SEAM_CURATED_CATALOG } from './plugin-capability-seam-catalog-curated.js'
import {
  containsSeamSensitiveContent,
  isSeamFindingWaiverable,
  validateSeamReportSchema,
} from './plugin-capability-seam-catalog.js'
import {
  loadSeamFixtureEntries,
  parseArgs,
  renderSeamList,
  runSeamCheck,
} from '../../../scripts/check-plugin-capability-seams.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixturesRoot = join(repoRoot, 'scripts/__fixtures__/plugin-capability-seams')
const FIXED_NOW = new Date('2026-08-16T00:00:00.000Z')

function fixturePath(name: string): string {
  return join(fixturesRoot, name)
}

// =============================================================================
// 5.2 CLI fixtures
// =============================================================================

describe('check-plugin-capability-seams CLI fixtures（5.2）', () => {
  it('clean：全部 family（12 类）全覆盖 → passed / exit 0 / 零 blocking', () => {
    const { report, exitCode } = runSeamCheck({
      fixturePath: fixturePath('clean.json'),
      now: FIXED_NOW,
    })
    expect(exitCode).toBe(0)
    expect(report.status).toBe('passed')
    expect(report.findings.length).toBe(0)
    expect(report.entryCount).toBe(12)
  })

  it('degraded：cataloged 证据过期 → 状态 degraded / exit 0 / warning 而非 blocking', () => {
    const { report, exitCode } = runSeamCheck({
      fixturePath: fixturePath('degraded.json'),
      now: FIXED_NOW,
    })
    expect(exitCode).toBe(0)
    expect(report.status).toBe('degraded')
    expect(report.findings.some((f) => f.severity === 'warning')).toBe(true)
    expect(report.findings.some((f) => f.severity === 'blocking')).toBe(false)
  })

  it('duplicate-family-gap：重复 identity + family gap → blocking / exit 1', () => {
    const { report, exitCode } = runSeamCheck({
      fixturePath: fixturePath('duplicate-family-gap.json'),
      now: FIXED_NOW,
    })
    expect(exitCode).toBe(1)
    expect(report.status).toBe('blocked')
    expect(report.findings.some((f) => f.code === 'seam-duplicate-identity')).toBe(true)
    expect(report.findings.some((f) => f.code === 'seam-required-family-gap')).toBe(true)
  })

  it('core-redline：跨租 scope / client tenant / 直写 → blocking redline 且不可 waiver / exit 1', () => {
    const { report, exitCode } = runSeamCheck({
      fixturePath: fixturePath('core-redline.json'),
      now: FIXED_NOW,
    })
    expect(exitCode).toBe(1)
    expect(report.status).toBe('blocked')
    const redlines = report.findings.filter((f) => f.code === 'seam-core-authority-delegation')
    expect(redlines.length).toBeGreaterThan(0)
    for (const finding of redlines) {
      expect(finding.severity).toBe('blocking')
      expect(isSeamFindingWaiverable(finding)).toBe(false)
    }
  })

  it('stale-host-ready：host-ready + stale evidence → blocking / exit 1', () => {
    const { report, exitCode } = runSeamCheck({
      fixturePath: fixturePath('stale-host-ready.json'),
      now: FIXED_NOW,
    })
    expect(exitCode).toBe(1)
    expect(
      report.findings.some((f) => f.code === 'seam-evidence-stale' && f.severity === 'blocking'),
    ).toBe(true)
  })

  it('sensitive-redaction：敏感输入 → blocking / exit 1，report JSON 不含原值', () => {
    const { report, exitCode } = runSeamCheck({
      fixturePath: fixturePath('sensitive-redaction.json'),
      now: FIXED_NOW,
    })
    expect(exitCode).toBe(1)
    expect(report.findings.some((f) => f.code === 'seam-redaction-violation')).toBe(true)
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('sk-proj')
    expect(serialized).not.toContain('api.openai.com')
    for (const finding of report.findings) {
      expect(containsSeamSensitiveContent(JSON.stringify(finding))).toBe(false)
    }
  })

  it('坏 fixture：文件不存在 / 非法 JSON → 抛出错误（调用层 exit 2）', () => {
    expect(() => loadSeamFixtureEntries(fixturePath('not-exist.json'))).toThrow()
    const badJson = join(fixturesRoot, 'bad-json.json')
    writeFileSync(badJson, '{ not json', 'utf8')
    try {
      expect(() => loadSeamFixtureEntries(badJson)).toThrow()
    } finally {
      rmSync(badJson, { force: true })
    }
    expect(() => loadSeamFixtureEntries(fixturePath('clean.json'))).not.toThrow()
    expect(() => loadSeamFixtureEntries(join(fixturesRoot, 'missing-entries.json'))).toThrow(
      /entries/,
    )
  })

  it('未知参数/缺值 → parseArgs error（main 层 exit 2）', () => {
    expect(parseArgs(['--bogus']).error).toBe('未知参数: --bogus')
    expect(parseArgs(['--output']).error).toBe('--output 需要值')
    expect(parseArgs(['--list', '--json', '--objective', 'obj']).error).toBeUndefined()
  })

  it('输出报告 schema：schemaVersion 1.0 / status / digest / families / findings 全齐', () => {
    const clean = runSeamCheck({ fixturePath: fixturePath('clean.json') })
    expect(validateSeamReportSchema(clean.report)).toEqual([])
    const blocked = runSeamCheck({ fixturePath: fixturePath('core-redline.json') })
    expect(validateSeamReportSchema(blocked.report)).toEqual([])
  })

  it('--list 输出确定性且只含低敏摘要字段', () => {
    const first = renderSeamList([...PLUGIN_SEAM_CURATED_CATALOG])
    const second = renderSeamList([...PLUGIN_SEAM_CURATED_CATALOG].reverse())
    expect(first).toBe(second)
    const lines = first.split('\n')
    expect(lines.length).toBe(PLUGIN_SEAM_CURATED_CATALOG.length)
    for (const line of lines) {
      expect(line).toMatch(
        /^[a-z0-9-]+\.[a-z0-9-]+@\d+\.\d+\.\d+ family=[a-z-]+ class=\S+ status=\S+ avail=\S+$/,
      )
    }
  })
})

// =============================================================================
// 5.4 稳定性：两次运行 + 重排输入
// =============================================================================

describe('checker 稳定性（5.4）', () => {
  it('同一 fixture 两次运行（固定时钟）：digest / findings / JSON 输出 / 退出码一致', () => {
    const a = runSeamCheck({ fixturePath: fixturePath('clean.json'), now: FIXED_NOW })
    const b = runSeamCheck({ fixturePath: fixturePath('clean.json'), now: FIXED_NOW })
    expect(a.report.catalogDigest).toBe(b.report.catalogDigest)
    expect(a.report.findings.map((f) => f.findingId)).toEqual(
      b.report.findings.map((f) => f.findingId),
    )
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report))
    expect(a.exitCode).toBe(b.exitCode)
  })

  it('重排输入：entries 顺序变化不改变 digest 与 findings（含 blocking 负例）', () => {
    const entries = [...PLUGIN_SEAM_CURATED_CATALOG]
    const a = runSeamCheck({ entries, now: FIXED_NOW })
    const b = runSeamCheck({ entries: [...entries].reverse(), now: FIXED_NOW })
    expect(a.report.catalogDigest).toBe(b.report.catalogDigest)
    expect(a.report.findings.map((f) => f.findingId)).toEqual(
      b.report.findings.map((f) => f.findingId),
    )
    expect(a.exitCode).toBe(b.exitCode)

    const bad = [...PLUGIN_SEAM_CURATED_CATALOG].map((e) =>
      e.surface === 'ui-slot' ? { ...e, scopeModes: [] } : e,
    )
    const r1 = runSeamCheck({ entries: bad, now: FIXED_NOW })
    const r2 = runSeamCheck({ entries: [...bad].reverse(), now: FIXED_NOW })
    expect(r1.exitCode).toBe(1)
    expect(r2.exitCode).toBe(1)
    expect(r1.report.catalogDigest).toBe(r2.report.catalogDigest)
    expect(JSON.stringify(r1.report.findings)).toBe(JSON.stringify(r2.report.findings))
  })

  it('text summary 稳定：固定时钟两次运行逐字一致', () => {
    const a = runSeamCheck({ fixturePath: fixturePath('degraded.json'), now: FIXED_NOW })
    const b = runSeamCheck({ fixturePath: fixturePath('degraded.json'), now: FIXED_NOW })
    expect(a.report.status).toBe('degraded')
    expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report))
  })
})
