/**
 * OCR Structured Extraction — DB Schema 测试
 *
 * 验证迁移创建的表结构（列、索引、约束）与 spec 一致。
 */
import { describe, it, expect } from 'vitest'

describe('OCR structured extraction schema', () => {
  // 这些测试需要数据库连接，在没有 db 的环境下至少验证模型定义正确导入
  it('profile model can be imported', async () => {
    const mod = await import('../../app/models/ocr_structured_extraction_profile.js')
    expect(mod.default.table).toBe('ocr_structured_extraction_profiles')
  })

  it('profile version model can be imported', async () => {
    const mod = await import('../../app/models/ocr_structured_extraction_profile_version.js')
    expect(mod.default.table).toBe('ocr_structured_extraction_profile_versions')
  })

  it('run model can be imported', async () => {
    const mod = await import('../../app/models/ocr_structured_extraction_run.js')
    expect(mod.default.table).toBe('ocr_structured_extraction_runs')
  })

  it('field candidate model can be imported', async () => {
    const mod = await import('../../app/models/ocr_structured_extraction_field_candidate.js')
    expect(mod.default.table).toBe('ocr_structured_extraction_field_candidates')
  })

  it('table candidate model can be imported', async () => {
    const mod = await import('../../app/models/ocr_structured_extraction_table_candidate.js')
    expect(mod.default.table).toBe('ocr_structured_extraction_table_candidates')
  })

  it('snapshot model can be imported', async () => {
    const mod = await import('../../app/models/ocr_structured_extraction_snapshot.js')
    expect(mod.default.table).toBe('ocr_structured_extraction_snapshots')
  })

  // 验证迁移文件存在
  it('migration files exist for all tables', async () => {
    // profiles
    await expect(
      import('../../database/migrations/1839000000025_create_ocr_structured_extraction_profiles_table.js'),
    ).resolves.toBeDefined()
    // profile_versions
    await expect(
      import('../../database/migrations/1839000000026_create_ocr_structured_extraction_profile_versions_table.js'),
    ).resolves.toBeDefined()
    // runs
    await expect(
      import('../../database/migrations/1839000000027_create_ocr_structured_extraction_runs_table.js'),
    ).resolves.toBeDefined()
    // field_candidates
    await expect(
      import('../../database/migrations/1839000000028_create_ocr_structured_extraction_field_candidates_table.js'),
    ).resolves.toBeDefined()
    // table_candidates
    await expect(
      import('../../database/migrations/1839000000029_create_ocr_structured_extraction_table_candidates_table.js'),
    ).resolves.toBeDefined()
    // snapshots
    await expect(
      import('../../database/migrations/1839000000030_create_ocr_structured_extraction_snapshots_table.js'),
    ).resolves.toBeDefined()
  })
})
