/**
 * 日历曆法显示设定（tyme4ts 支持的曆法）。
 *
 * 一个有序列表：第一个「可当主曆」的曆法决定月份怎么排、格子大数字；其余作为副曆标注叠加在格子里。
 * 设定分三层，生效优先序：个人 > 项目 > 组织 > 系统默认。
 */

/** 有完整年 / 月 / 日、可以排月格的曆法。 */
export const PRIMARY_CALENDAR_SYSTEMS = ['solar', 'lunar', 'tibetan', 'hijri'] as const

/** 只能作为副曆标注的曆法 / 历注。 */
export const ANNOTATION_CALENDAR_SYSTEMS = [
  'ganzhi',
  'jieqi',
  'phenology',
  'dogday',
  'nineday',
  'plumrain',
  'phase',
  'constellation',
  'festival',
  'holiday',
] as const

export const CALENDAR_SYSTEM_IDS = [
  ...PRIMARY_CALENDAR_SYSTEMS,
  ...ANNOTATION_CALENDAR_SYSTEMS,
] as const

export type PrimaryCalendarSystem = (typeof PRIMARY_CALENDAR_SYSTEMS)[number]
export type CalendarSystemId = (typeof CALENDAR_SYSTEM_IDS)[number]

export const CALENDAR_SYSTEM_LABELS: Readonly<Record<CalendarSystemId, string>> = {
  solar: '公历（西历）',
  lunar: '农历',
  tibetan: '藏历',
  hijri: '回历（伊斯兰历）',
  ganzhi: '干支',
  jieqi: '二十四节气',
  phenology: '七十二物候',
  dogday: '三伏',
  nineday: '数九',
  plumrain: '入梅 / 出梅',
  phase: '月相',
  constellation: '星座',
  festival: '传统与公历节日',
  holiday: '法定节假日（休 / 班）',
}

/** 系统默认：公历为主，农历、节气、节日、法定假日为副。 */
export const DEFAULT_CALENDAR_SYSTEMS: readonly CalendarSystemId[] = [
  'solar',
  'lunar',
  'jieqi',
  'festival',
  'holiday',
]

export type CalendarDisplayLayer = 'personal' | 'project' | 'organization'
export type CalendarDisplaySource = CalendarDisplayLayer | 'default'

export const CALENDAR_DISPLAY_LAYER_LABELS: Readonly<Record<CalendarDisplaySource, string>> = {
  personal: '个人设定',
  project: '项目设定',
  organization: '组织默认',
  default: '系统默认',
}

const ID_SET: ReadonlySet<string> = new Set(CALENDAR_SYSTEM_IDS)
const PRIMARY_SET: ReadonlySet<string> = new Set(PRIMARY_CALENDAR_SYSTEMS)

export function isCalendarSystemId(value: unknown): value is CalendarSystemId {
  return typeof value === 'string' && ID_SET.has(value)
}

export function isPrimaryCalendarSystem(value: unknown): value is PrimaryCalendarSystem {
  return typeof value === 'string' && PRIMARY_SET.has(value)
}

/** 清洗一份曆法列表：只认已知 id、去重、保持顺序；空或非法返回 null（= 未设定，继承上层）。 */
export function normalizeCalendarSystems(raw: unknown): CalendarSystemId[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const systems: CalendarSystemId[] = []
  for (const item of raw) {
    if (!isCalendarSystemId(item) || seen.has(item)) continue
    seen.add(item)
    systems.push(item)
  }
  return systems.length > 0 ? systems : null
}

/** 主曆：列表里第一个可当主曆的；都没有则公历。 */
export function primaryCalendarOf(systems: readonly CalendarSystemId[]): PrimaryCalendarSystem {
  return (systems.find((id) => isPrimaryCalendarSystem(id)) as PrimaryCalendarSystem) ?? 'solar'
}

/** 副曆：除主曆外的其余（保持勾选顺序）。 */
export function secondaryCalendarsOf(systems: readonly CalendarSystemId[]): CalendarSystemId[] {
  const primary = primaryCalendarOf(systems)
  return systems.filter((id) => id !== primary)
}

export interface CalendarDisplayLayers {
  organization: CalendarSystemId[] | null
  project: CalendarSystemId[] | null
  personal: CalendarSystemId[] | null
}

export interface CalendarDisplayResolution {
  /** 生效的曆法列表（有序）。 */
  systems: CalendarSystemId[]
  primary: PrimaryCalendarSystem
  /** 生效值来自哪一层。 */
  source: CalendarDisplaySource
  layers: CalendarDisplayLayers
  /** 当前用户能修改的层（项目层需要项目编辑权限，组织层需要组织管理权限）。 */
  editable: Record<CalendarDisplayLayer, boolean>
}

/** 按「个人 > 项目 > 组织 > 默认」求生效设定。 */
export function resolveCalendarDisplay(
  layers: CalendarDisplayLayers,
): Pick<CalendarDisplayResolution, 'systems' | 'primary' | 'source'> {
  const order: CalendarDisplayLayer[] = ['personal', 'project', 'organization']
  for (const layer of order) {
    const systems = layers[layer]
    if (systems && systems.length > 0) {
      return { systems, primary: primaryCalendarOf(systems), source: layer }
    }
  }
  const systems = [...DEFAULT_CALENDAR_SYSTEMS]
  return { systems, primary: primaryCalendarOf(systems), source: 'default' }
}
