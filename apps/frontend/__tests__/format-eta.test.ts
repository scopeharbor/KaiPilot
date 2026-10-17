import { describe, expect, it } from 'vitest'
import { formatEta } from '@/lib/realtime/format-eta'

describe('formatEta', () => {
  describe('秒级时长（< 1 分钟）', () => {
    it('45 秒 → 不到 1 分钟', () => {
      expect(formatEta(45_000)).toBe('不到 1 分钟')
    })

    it('1 毫秒 → 不到 1 分钟', () => {
      expect(formatEta(1)).toBe('不到 1 分钟')
    })

    it('59999 毫秒（差 1 毫秒到 1 分钟）→ 不到 1 分钟', () => {
      expect(formatEta(59_999)).toBe('不到 1 分钟')
    })
  })

  describe('分钟级时长（< 1 小时）', () => {
    it('180000 毫秒（3 分钟）→ ~3 分钟', () => {
      expect(formatEta(180_000)).toBe('~3 分钟')
    })

    it('60000 毫秒（正好 1 分钟）→ ~1 分钟', () => {
      expect(formatEta(60_000)).toBe('~1 分钟')
    })

    it('90000 毫秒（1.5 分钟）→ 四舍五入 ~2 分钟', () => {
      expect(formatEta(90_000)).toBe('~2 分钟')
    })

    it('120000 毫秒（2 分钟）→ ~2 分钟', () => {
      expect(formatEta(120_000)).toBe('~2 分钟')
    })

    it('四舍五入边界：149999 毫秒 → ~2 分钟', () => {
      expect(formatEta(149_999)).toBe('~2 分钟')
    })

    it('四舍五入边界：150000 毫秒 → ~3 分钟', () => {
      // 2.5 分钟四舍五入到 3
      expect(formatEta(150_000)).toBe('~3 分钟')
    })

    it('3500000 毫秒（~58.33 分钟）→ ~58 分钟', () => {
      expect(formatEta(3_500_000)).toBe('~58 分钟')
    })
  })

  describe('小时级时长（≥ 1 小时）', () => {
    it('5400000 毫秒（90 分钟）→ ~1 小时 30 分钟', () => {
      expect(formatEta(5_400_000)).toBe('~1 小时 30 分钟')
    })

    it('3600000 毫秒（正好 1 小时）→ ~1 小时 0 分钟', () => {
      expect(formatEta(3_600_000)).toBe('~1 小时 0 分钟')
    })

    it('7200000 毫秒（2 小时）→ ~2 小时 0 分钟', () => {
      expect(formatEta(7_200_000)).toBe('~2 小时 0 分钟')
    })

    it('3900000 毫秒（65 分钟）→ ~1 小时 5 分钟', () => {
      expect(formatEta(3_900_000)).toBe('~1 小时 5 分钟')
    })

    it('分钟进位到 60 时归入小时级：3599999 毫秒（~60 分钟）→ ~1 小时 0 分钟', () => {
      // 59.99998 分钟四舍五入到 60 → 归入小时级
      expect(formatEta(3_599_999)).toBe('~1 小时 0 分钟')
    })
  })

  describe('零值、负值与 null 边界', () => {
    it('null → 空串', () => {
      expect(formatEta(null)).toBe('')
    })

    it('undefined → 空串', () => {
      expect(formatEta(undefined)).toBe('')
    })

    it('0 → 空串', () => {
      expect(formatEta(0)).toBe('')
    })

    it('负值 → 空串', () => {
      expect(formatEta(-1000)).toBe('')
      expect(formatEta(-1)).toBe('')
    })

    it('NaN → 空串', () => {
      expect(formatEta(Number.NaN)).toBe('')
    })

    it('Infinity → 空串', () => {
      expect(formatEta(Number.POSITIVE_INFINITY)).toBe('')
    })
  })

  describe('确定性', () => {
    it('同一输入多次调用返回相同结果', () => {
      expect(formatEta(180_000)).toBe(formatEta(180_000))
      expect(formatEta(5_400_000)).toBe(formatEta(5_400_000))
    })
  })
})
