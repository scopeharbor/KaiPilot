import { describe, expect, it } from 'vitest'
import ExchangeRateService, {
  normalizeDisplayCurrency,
  type ExchangeRateTable,
} from '#services/ai_pricing/exchange_rate_service'

describe('exchange rate service', () => {
  const table: ExchangeRateTable = {
    ratesPerEur: { EUR: 1, USD: 1.2, CNY: 8.4 },
    asOf: '2026-10-01',
    fetchedAt: '2026-10-01T16:00:00.000Z',
    source: 'frankfurter.dev',
    stale: false,
  }

  it('uses EUR cross rates instead of mixing currency amounts', () => {
    const service = new ExchangeRateService()
    expect(service.convert(10, 'USD', 'CNY', table)).toBeCloseTo(70, 8)
    expect(service.convert(10, 'CNY', 'USD', table)).toBeCloseTo(10 / 7, 8)
    expect(service.convert(10, 'USD', 'USD', table)).toBe(10)
  })

  it('returns null for unavailable currencies and validates ISO codes', () => {
    const service = new ExchangeRateService()
    expect(service.convert(10, 'USD', 'TWD', table)).toBeNull()
    expect(normalizeDisplayCurrency('cny')).toBe('CNY')
    expect(() => normalizeDisplayCurrency('人民币')).toThrow(/3 位 ISO 4217/)
  })
})
