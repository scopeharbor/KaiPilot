/**
 * v3-llm-wiki-memory-foundation —— 架构守护（静态扫描源码）。
 *
 * 1. 唯一转正门：除 WikiRevisionService 外，任何代码不得把修订置为 published 或写页面的已发布指针；
 * 2. 查阅能力交付前：Copilot 上下文装配、AI 草案、AI 同事、Compiler 路径不得引用维基服务或模型；
 * 3. 维基服务中只有编入模型端口可以引用 AI 网关/适配器。
 */
import { test } from '@japa/runner'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../app')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const rel = (f: string) => path.relative(appDir, f).split(path.sep).join('/')

test.group('记忆维基 · 架构守护', () => {
  test('只有 WikiRevisionService 能发布修订与移动已发布指针', ({ assert }) => {
    const writers = walk(appDir).filter((file) => {
      const src = fs.readFileSync(file, 'utf8')
      const movesPointer =
        /published_revision_id\s*:/.test(src) || /\.publishedRevisionId\s*=(?!=)/.test(src)
      const publishesRevision =
        /wiki_revisions[\s\S]{0,400}status:\s*'published'/.test(src) ||
        /revision\.status\s*=\s*'published'/.test(src)
      return movesPointer || publishesRevision
    })
    assert.deepEqual(writers.map(rel), ['services/wiki_memory/wiki_revision_service.ts'])
  })

  // v3-llm-wiki-query-navigation：Copilot 只经 ai_tools 维基工具与回合影子端口（结构类型）读取维基，这些目录仍不得直接引用
  test('Copilot 上下文装配、回合、AI 同事规划器与草案生成路径不直接读取维基', ({ assert }) => {
    const guarded = [
      'services/copilot',
      'services/copilot_turn',
      'services/copilot_memory',
      'services/ai_draft',
      'services/ai_colleague',
      'services/compiler',
      'services/ai_m0',
    ]
    const offenders: string[] = []
    for (const dir of guarded) {
      const full = path.join(appDir, dir)
      if (!fs.existsSync(full)) continue
      for (const file of walk(full)) {
        const src = fs.readFileSync(file, 'utf8')
        if (/wiki_memory|#models\/wiki_|wiki_pages|wiki_claims/.test(src)) offenders.push(rel(file))
      }
    }
    assert.deepEqual(offenders, [])
  })

  test('维基服务中只有编入模型端口引用模型网关（v3-llm-wiki-ingest-pipeline）', ({ assert }) => {
    const offenders = walk(path.join(appDir, 'services/wiki_memory'))
      .filter((file) =>
        /ai_gateway|resolveAdapter|ai_m0|#services\/adapters/.test(fs.readFileSync(file, 'utf8')),
      )
      .map(rel)
    assert.deepEqual(offenders, ['services/wiki_memory/ingest/wiki_ingest_model_port.ts'])
  })
})
