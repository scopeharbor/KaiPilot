import OrganizationSetting from '#models/organization_setting'
import { ValidationException } from '#exceptions/api_exception'

export const AI_COST_DISPLAY_CURRENCY_KEY = 'ai.cost.display_currency'
export const DEFAULT_AI_COST_CURRENCY = 'USD'
export const EXCHANGE_RATE_SOURCE = 'frankfurter.dev'
const RATE_ENDPOINT = 'https://api.frankfurter.dev/v2/rates'
const FRESH_TTL_MS = 12 * 60 * 60 * 1000
const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FAILED_RETRY_TTL_MS = 5 * 60 * 1000

interface RateRow {
  date: string
  base: string
  quote: string
  rate: number
}

export interface ExchangeRateTable {
  ratesPerEur: Record<string, number>
  asOf: string
  fetchedAt: string
  source: typeof EXCHANGE_RATE_SOURCE
  stale: boolean
}

let cachedTable: ExchangeRateTable | null = null
let cacheFetchedAt = 0
let cacheAttemptedAt = 0
let inflight: Promise<ExchangeRateTable | null> | null = null

export function normalizeDisplayCurrency(raw: unknown): string {
  const value = String(raw ?? DEFAULT_AI_COST_CURRENCY)
    .trim()
    .toUpperCase()
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new ValidationException('展示币种必须是 3 位 ISO 4217 代码（如 USD、CNY、EUR）')
  }
  return value
}

export default class ExchangeRateService {
  async getDisplayCurrency(organizationId: number): Promise<string> {
    const row = await OrganizationSetting.query()
      .where('organization_id', organizationId)
      .where('key', AI_COST_DISPLAY_CURRENCY_KEY)
      .first()
    return normalizeDisplayCurrency(row?.value ?? DEFAULT_AI_COST_CURRENCY)
  }

  async setDisplayCurrency(organizationId: number, currency: string): Promise<string> {
    const normalized = normalizeDisplayCurrency(currency)
    const existing = await OrganizationSetting.query()
      .where('organization_id', organizationId)
      .where('key', AI_COST_DISPLAY_CURRENCY_KEY)
      .first()
    if (existing) {
      existing.value = normalized
      await existing.save()
    } else {
      await OrganizationSetting.create({
        organizationId,
        key: AI_COST_DISPLAY_CURRENCY_KEY,
        value: normalized,
      })
    }
    return normalized
  }

  async latestTable(): Promise<ExchangeRateTable | null> {
    const age = Date.now() - cacheFetchedAt
    if (cachedTable && age < FRESH_TTL_MS) return cachedTable
    if (cacheAttemptedAt > 0 && Date.now() - cacheAttemptedAt < FAILED_RETRY_TTL_MS) {
      return cachedTable && age < STALE_TTL_MS ? { ...cachedTable, stale: true } : null
    }
    if (inflight) return inflight
    inflight = this.#fetchTable().finally(() => {
      inflight = null
    })
    return inflight
  }

  convert(value: number, from: string, to: string, table: ExchangeRateTable): number | null {
    const source = normalizeDisplayCurrency(from)
    const target = normalizeDisplayCurrency(to)
    if (source === target) return value
    const sourcePerEur = source === 'EUR' ? 1 : table.ratesPerEur[source]
    const targetPerEur = target === 'EUR' ? 1 : table.ratesPerEur[target]
    if (!sourcePerEur || !targetPerEur) return null
    return (value / sourcePerEur) * targetPerEur
  }

  async #fetchTable(): Promise<ExchangeRateTable | null> {
    cacheAttemptedAt = Date.now()
    try {
      const response = await fetch(RATE_ENDPOINT, { signal: AbortSignal.timeout(5_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const rows = (await response.json()) as RateRow[]
      const eurRows = Array.isArray(rows)
        ? rows.filter(
            (row) =>
              row?.base === 'EUR' &&
              /^[A-Z]{3}$/.test(row.quote) &&
              Number.isFinite(row.rate) &&
              row.rate > 0,
          )
        : []
      if (eurRows.length === 0) throw new Error('汇率响应不含 EUR 基准数据')
      const ratesPerEur: Record<string, number> = { EUR: 1 }
      for (const row of eurRows) ratesPerEur[row.quote] = row.rate
      cachedTable = {
        ratesPerEur,
        asOf:
          eurRows
            .map((row) => row.date)
            .sort()
            .at(-1) ?? new Date().toISOString().slice(0, 10),
        fetchedAt: new Date().toISOString(),
        source: EXCHANGE_RATE_SOURCE,
        stale: false,
      }
      cacheFetchedAt = Date.now()
      return cachedTable
    } catch {
      if (cachedTable && Date.now() - cacheFetchedAt < STALE_TTL_MS) {
        return { ...cachedTable, stale: true }
      }
      return null
    }
  }
}
