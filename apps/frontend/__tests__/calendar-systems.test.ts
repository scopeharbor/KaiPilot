import { describe, expect, test } from 'vitest'
import {
  annotationFor,
  annotationsFor,
  primaryMonthAt,
  solarSpanLabel,
  weekdayIndex,
} from '@/lib/calendar-systems'
import { primaryCalendarOf, resolveCalendarDisplay } from '@aiproj/types'

describe('主曆排月格', () => {
  test('公历：2026 年 10 月共 31 天，可前后翻月', () => {
    const month = primaryMonthAt('solar', '2026-10-15')
    expect(month.title).toBe('2026年10月')
    expect(month.days).toHaveLength(31)
    expect(month.days[0]).toEqual({ dateISO: '2026-10-01', dayLabel: '1' })
    expect(primaryMonthAt('solar', '2026-12-05', 1).title).toBe('2027年1月')
    expect(primaryMonthAt('solar', '2026-01-05', -1).title).toBe('2025年12月')
  })

  test('农历：八月从公历 9 月 11 日开始，格子显示农历日', () => {
    const month = primaryMonthAt('lunar', '2026-10-01')
    expect(month.title).toBe('农历丙午年八月')
    expect(month.startISO).toBe('2026-09-11')
    expect(month.days[0]!.dayLabel).toBe('初一')
    expect(solarSpanLabel(month)).toContain('公历 2026年9月11日')
    expect(primaryMonthAt('lunar', '2026-10-01', 1).title).toBe('农历丙午年九月')
  })

  test('回历与藏历都能排月格，日期连续', () => {
    const hijri = primaryMonthAt('hijri', '2026-10-01')
    expect(hijri.title).toBe('1448年赖比尔·阿色尼月')
    expect(hijri.startISO).toBe('2026-09-14')
    const tibetan = primaryMonthAt('tibetan', '2026-10-01')
    expect(tibetan.title).toBe('第十七饶迥火马年八月')
    expect(tibetan.days.length).toBeGreaterThan(27)
  })

  test('星期一为 0，星期日为 6', () => {
    expect(weekdayIndex('2026-10-01')).toBe(3)
    expect(weekdayIndex('2026-10-04')).toBe(6)
  })
})

describe('副曆标注', () => {
  test('农历、法定假日、节日、节气', () => {
    expect(annotationFor('2026-10-01', 'lunar')?.short).toBe('廿一')
    expect(annotationFor('2026-10-01', 'holiday')).toMatchObject({ short: '休', tone: 'off' })
    expect(annotationFor('2026-10-10', 'holiday')).toMatchObject({ short: '班', tone: 'work' })
    expect(annotationFor('2026-10-01', 'festival')?.short).toBe('国庆节')
    expect(annotationFor('2026-10-08', 'jieqi')?.short).toBe('寒露')
    expect(annotationFor('2026-10-09', 'jieqi')).toBeNull()
  })

  test('只在起始日标注的历注；按勾选顺序输出、跳过空', () => {
    expect(annotationFor('2026-10-26', 'phase')?.short).toBe('满月')
    expect(annotationFor('2026-10-27', 'phase')).toBeNull()
    const list = annotationsFor('2026-10-01', ['holiday', 'jieqi', 'lunar', 'hijri'])
    expect(list.map((item) => item.system)).toEqual(['holiday', 'lunar', 'hijri'])
    expect(list[2]!.short).toBe('回18')
  })
})

describe('设定解析', () => {
  test('主曆取第一个可当主曆的；个人 > 项目 > 组织 > 默认', () => {
    expect(primaryCalendarOf(['jieqi', 'hijri', 'solar'])).toBe('hijri')
    expect(primaryCalendarOf(['jieqi'])).toBe('solar')
    expect(
      resolveCalendarDisplay({ organization: ['lunar'], project: ['hijri'], personal: null }),
    ).toMatchObject({ source: 'project', primary: 'hijri' })
    expect(
      resolveCalendarDisplay({ organization: null, project: null, personal: null }).source,
    ).toBe('default')
  })
})
