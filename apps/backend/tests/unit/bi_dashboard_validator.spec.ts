// v3-bi-dashboard-builder §3.5 & §4.5 — BI Dashboard Validator 与 Registry 单元测试。

import { test } from '@japa/runner'
import { validateWidgetsAgainstRegistry } from '#validators/bi_dashboard'
import { getAvailableWidgetKeys } from '#services/bi_dashboard/widget_registry'

test.group('BI Dashboard Validator', () => {
  test('validates empty widgets', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry([], new Set(['bi_trend']))
    assert.isTrue(result.valid)
    assert.lengthOf(result.errors, 0)
  })

  test('validates valid widget key', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [{ widgetKey: 'bi_trend', size: 'medium', position: { x: 0, y: 0, w: 1, h: 1 } }],
      new Set(['bi_trend']),
    )
    assert.isTrue(result.valid)
  })

  test('rejects unknown widget key', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [{ widgetKey: 'unknown_widget', size: 'medium', position: { x: 0, y: 0, w: 1, h: 1 } }],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
    assert.include(result.errors[0], 'unknown')
  })

  test('rejects widget with sql in settings', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [
        {
          widgetKey: 'bi_trend',
          size: 'medium',
          position: { x: 0, y: 0, w: 1, h: 1 },
          settings: { sql: 'SELECT *' },
        },
      ],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
    assert.include(result.errors[0], 'forbidden field')
  })

  test('rejects widget with prompt in settings', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [
        {
          widgetKey: 'bi_trend',
          size: 'medium',
          position: { x: 0, y: 0, w: 1, h: 1 },
          settings: { prompt: 'generate' },
        },
      ],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
  })

  test('rejects widget with script in settings', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [
        {
          widgetKey: 'bi_trend',
          size: 'medium',
          position: { x: 0, y: 0, w: 1, h: 1 },
          settings: { script: 'alert(1)' },
        },
      ],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
  })

  test('rejects widget with url in settings', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [
        {
          widgetKey: 'bi_trend',
          size: 'medium',
          position: { x: 0, y: 0, w: 1, h: 1 },
          settings: { url: 'http://evil.com' },
        },
      ],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
  })

  test('rejects widget with secret in settings', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [
        {
          widgetKey: 'bi_trend',
          size: 'medium',
          position: { x: 0, y: 0, w: 1, h: 1 },
          settings: { secret: 'key123' },
        },
      ],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
  })

  test('rejects widget with token in settings', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [
        {
          widgetKey: 'bi_trend',
          size: 'medium',
          position: { x: 0, y: 0, w: 1, h: 1 },
          settings: { token: 'jwt.abc' },
        },
      ],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
  })

  test('rejects widget with formula in settings', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [
        {
          widgetKey: 'bi_trend',
          size: 'medium',
          position: { x: 0, y: 0, w: 1, h: 1 },
          settings: { formula: '1+1' },
        },
      ],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
  })

  test('rejects widget missing widgetKey', ({ assert }) => {
    const result = validateWidgetsAgainstRegistry(
      [{ size: 'medium', position: { x: 0, y: 0, w: 1, h: 1 } }],
      new Set(['bi_trend']),
    )
    assert.isFalse(result.valid)
    assert.include(result.errors[0], 'missing widgetKey')
  })

  test('rejects exceeding max widget count', ({ assert }) => {
    const widgets = Array.from({ length: 13 }, (_, i) => ({
      widgetKey: 'bi_trend',
      size: 'small',
      position: { x: i, y: 0, w: 1, h: 1 },
    }))
    const result = validateWidgetsAgainstRegistry(widgets, new Set(['bi_trend']))
    assert.isFalse(result.valid)
    assert.include(result.errors[0], 'exceeds maximum')
  })
})

test.group('BI Dashboard Widget Registry', () => {
  test('all registered widget keys are available', ({ assert }) => {
    const keys = getAvailableWidgetKeys()
    assert.isTrue(keys.has('bi_trend'))
    assert.isTrue(keys.has('bi_risk_heatmap'))
    assert.isTrue(keys.has('bi_custom_report_summary'))
    assert.isTrue(keys.has('pmo_health'))
    assert.isTrue(keys.has('resource_summary'))
    assert.isTrue(keys.has('okr_summary'))
    assert.isTrue(keys.has('organization_dashboard_summary'))
  })

  test('registry has exactly 7 P0 widgets', ({ assert }) => {
    const keys = getAvailableWidgetKeys()
    assert.equal(keys.size, 7)
  })
})
