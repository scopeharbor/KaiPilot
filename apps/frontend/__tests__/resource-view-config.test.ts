import { describe, expect, test } from 'vitest'
import { resourceAdapter } from '@/lib/view-config/resource-adapter'

describe('resourceAdapter', () => {
  test('captures and restores resource workbench filters', () => {
    const params = new URLSearchParams(
      'from=2026-11-01&to=2026-11-07&role=member&skill=React&loadStatus=available&mode=requirements',
    )

    const config = resourceAdapter.capture(params, { viewMode: 'requirements' })

    expect(config).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        baseViewType: 'resource',
        filters: expect.objectContaining({
          roles: ['member'],
          skills: ['React'],
          loadStatuses: ['available'],
          dateFrom: '2026-11-01',
          dateTo: '2026-11-07',
        }),
        display: expect.objectContaining({ resourceViewMode: 'requirements' }),
      }),
    )

    const restored = resourceAdapter.toSearchParams(config)
    expect(restored.get('from')).toBe('2026-11-01')
    expect(restored.get('to')).toBe('2026-11-07')
    expect(restored.get('role')).toBe('member')
    expect(restored.get('skill')).toBe('React')
    expect(restored.get('loadStatus')).toBe('available')
    expect(restored.get('mode')).toBe('requirements')
    expect(resourceAdapter.summarize(config)).toContain('需求视图')
  })
})
