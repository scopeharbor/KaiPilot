import { parseTeamRoster } from '#services/ai_draft/resource_plan'
import {
  AI_INTENT_SCHEMA_VERSION,
  type IntentEntity,
  type IntentEntityType,
  type ParsedIntent,
  type ProjectType,
} from '@aiproj/types'

type EntityValue = string | number

const PROJECT_TYPE_KEYWORDS: Record<Exclude<ProjectType, 'general'>, readonly string[]> = {
  software: [
    '软件',
    '系统',
    '网站',
    '平台',
    '小程序',
    'app',
    '应用',
    '接口',
    'api',
    '前端',
    '后端',
    // 实测「年会抽奖和节目投票的 H5 页面」一个词都没命中，落到「通用项目」。
    'h5',
    '页面',
    '网页',
    '公众号',
    '后台',
    '数据库',
    '客户端',
  ],
  event: [
    '活动',
    '会议',
    '展会',
    '发布会',
    '培训',
    '婚礼',
    '赛事',
    '庆典',
    '年会',
    '晚会',
    '节目',
    '团建',
    '典礼',
    '峰会',
    '演出',
    '表演',
    '音乐会',
    '音乐节',
    '售票',
    '票务',
    '场地',
    '舞台',
    '灯光',
    '音响',
    '帐篷',
    '摊位',
    '停车',
    '接驳',
    '许可证',
    '安保',
    '医疗',
    '彩排',
    '雨天',
  ],
  research: ['研究', '调研', '实验', '论文', '课题', '分析报告', '文献'],
  product: ['产品', '新品', '原型', '市场验证', '用户访谈', '商业化', '发布'],
}

const TECHNOLOGIES = [
  'Next.js',
  'React',
  'Vue',
  'Angular',
  'TypeScript',
  'JavaScript',
  'Node.js',
  'AdonisJS',
  'Python',
  'Java',
  'Go',
  'Rust',
  'Flutter',
  'PostgreSQL',
  'MySQL',
  'SQLite',
] as const

const PLATFORMS = [
  'Web',
  '网页',
  '网站',
  'iOS',
  'Android',
  '微信小程序',
  '小程序',
  '桌面端',
] as const

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))))
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, ' ')
}

function pushEntity(
  entities: IntentEntity[],
  rawInput: string,
  type: IntentEntityType,
  text: string,
  value: EntityValue,
  confidence = 0.96,
  fromIndex = 0,
): void {
  const start = rawInput.indexOf(text, fromIndex)
  if (start < 0 || entities.some((entity) => entity.type === type && entity.start === start)) {
    return
  }

  entities.push({
    type,
    value,
    text,
    start,
    end: start + text.length,
    confidence: clampConfidence(confidence),
    source: 'explicit',
  })
}

const TIE_BREAK_ORDER = ['software', 'product', 'research', 'event'] as const

function classifyProjectType(rawInput: string): { projectType: ProjectType; confidence: number } {
  // 「会议室 / 活动室」是场所名，不代表要办一场会议（实测会议室预订小程序被判成活动项目）。
  const lowerInput = rawInput.toLowerCase().replace(/会议室|活动室|培训室/g, '')
  const scores = Object.entries(PROJECT_TYPE_KEYWORDS).map(([projectType, keywords]) => ({
    projectType: projectType as Exclude<ProjectType, 'general'>,
    score: keywords.reduce(
      (sum, keyword) => sum + (lowerInput.includes(keyword.toLowerCase()) ? 1 : 0),
      0,
    ),
  }))
  scores.sort(
    // 同分时「要做一个系统 / 小程序」比活动类词更能说明项目性质：软件优先，其余按固定顺序。
    (left, right) =>
      right.score - left.score ||
      TIE_BREAK_ORDER.indexOf(left.projectType) - TIE_BREAK_ORDER.indexOf(right.projectType),
  )
  const best = scores[0]

  if (!best || best.score === 0) {
    return { projectType: 'general', confidence: 0.35 }
  }

  return {
    projectType: best.projectType,
    confidence: clampConfidence(0.62 + Math.min(best.score, 3) * 0.1),
  }
}

function extractMatches(
  rawInput: string,
  expression: RegExp,
  type: IntentEntityType,
  value: (match: RegExpExecArray) => EntityValue,
  confidence = 0.97,
): IntentEntity[] {
  const entities: IntentEntity[] = []
  for (const match of rawInput.matchAll(expression)) {
    if (match.index === undefined) {
      continue
    }
    entities.push({
      type,
      value: value(match),
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      confidence,
      source: 'explicit',
    })
  }
  return entities
}

function toIsoDate(match: RegExpExecArray): string {
  const year = match.groups?.year ?? ''
  const month = (match.groups?.month ?? '').padStart(2, '0')
  const day = (match.groups?.day ?? '').padStart(2, '0')
  return `${year}-${month}-${day}`
}

function durationInDays(match: RegExpExecArray): number {
  const amount = Number(match.groups?.amount ?? 0)
  const unit = match.groups?.unit
  if (unit === '周' || unit?.toLowerCase() === 'week' || unit?.toLowerCase() === 'weeks') {
    return amount * 7
  }
  if (unit === '月' || unit?.toLowerCase() === 'month' || unit?.toLowerCase() === 'months') {
    return amount * 30
  }
  return amount
}

/**
 * 「2027 年 4 月中旬」「12 月中旬至 1 月上旬」里的「N 月」是日历月份而非工期：
 * 前面紧挨「年」，或后面紧跟 旬/初/底/末/份/N日。
 */
function isCalendarMonth(rawInput: string, entity: IntentEntity): boolean {
  if (!/月$/u.test(entity.text)) return false
  const before = rawInput.slice(Math.max(0, entity.start - 3), entity.start)
  // 往后看 8 个字：带空格的「10 月 12 日」后面是「 12 日」（5 个字），只看 4 个字会漏掉「日」，
  // 把「10 月」读成工期 10 个月（300 天）。
  const after = rawInput.slice(entity.end, entity.end + 8)
  return /年\s*$/u.test(before) || /^\s*(?:[上中下]旬|初|底|末|份|\d{1,2}\s*[日号])/u.test(after)
}

function isProjectDuration(rawInput: string, entity: IntentEntity): boolean {
  const before = rawInput.slice(Math.max(0, entity.start - 6), entity.start)
  return /(?:周期|工期|为期|历时|持续|用时|耗时)\s*(?:约|大约|预计|为)?\s*$/u.test(before)
}

/** 「2027 年 4 月中旬完成」一类月份粒度的截止时间 → deadline（上旬 10 日、中旬 20 日、下旬/底/末 月末、初 5 日）。 */
function extractMonthPhraseDeadlines(rawInput: string): IntentEntity[] {
  const entities: IntentEntity[] = []
  const expression =
    /(?<year>20\d{2})\s*年\s*(?<month>1[0-2]|0?[1-9])\s*月\s*(?<part>上旬|中旬|下旬|初|底|末)/gu
  for (const match of rawInput.matchAll(expression)) {
    if (match.index === undefined) continue
    const end = match.index + match[0].length
    const before = rawInput.slice(Math.max(0, match.index - 8), match.index)
    const after = rawInput.slice(end, end + 8)
    if (
      !/完成|上线|切换|交付|结束|验收|投产/u.test(after) &&
      !/截止|目标|之前|前于/u.test(before)
    ) {
      continue
    }
    const year = Number(match.groups?.year)
    const month = Number(match.groups?.month)
    const part = match.groups?.part
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const day = part === '上旬' ? 10 : part === '中旬' ? 20 : part === '初' ? 5 : lastDay
    entities.push({
      type: 'deadline',
      value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      text: match[0],
      start: match.index,
      end,
      confidence: 0.8,
      source: 'explicit',
    })
  }
  return entities
}

function isAudienceQuantity(rawInput: string, match: RegExpExecArray): boolean {
  const start = match.index ?? 0
  const end = start + match[0].length
  const context = rawInput.slice(Math.max(0, start - 8), Math.min(rawInput.length, end + 8))
  return /观众|购票|参会|参加|参与者|宾客|客户|用户|来宾|听众|人户外/u.test(context)
}

function extractTeamSizeEntities(rawInput: string): IntentEntity[] {
  const entities: IntentEntity[] = []
  const expression = /(?<amount>\d{1,3})\s*(?:人|名成员|名同事|名)/gu
  for (const match of rawInput.matchAll(expression)) {
    if (match.index === undefined || isAudienceQuantity(rawInput, match)) {
      continue
    }
    entities.push({
      type: 'team_size',
      value: Number(match.groups?.amount ?? 0),
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
      confidence: 0.97,
      source: 'explicit',
    })
  }
  // 「前端 1 人、后端 1 人、测试 1 人」是名册：各个「1 人」是角色人数，团队是它们的合计
  // （实测就绪页把团队显示成「1 人」）。原话另写了总人数（「共 5 人」「团队 5 人」）时以总数为准。
  const roster = parseTeamRoster(rawInput)
  const statedTotal = /(?:共|总共|一共|合计|团队|小组)\s*(?:约|大约)?\s*\d{1,3}\s*(?:人|名)/u.test(
    rawInput,
  )
  if (roster.length >= 2 && !statedTotal && entities.length > 0) {
    const first = entities[0]!
    const last = entities.at(-1)!
    return [
      {
        type: 'team_size',
        value: roster.reduce((sum, entry) => sum + entry.headcount, 0),
        text: rawInput.slice(first.start, last.end),
        start: first.start,
        end: last.end,
        confidence: 0.95,
        source: 'explicit',
      },
    ]
  }
  return entities
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalize).filter(Boolean))]
}

function extractProjectName(rawInput: string, entities: IntentEntity[]): string | null {
  const match =
    /(?:创建|开发|建设|举办|研究|设计|推出|做一个?|启动)\s*([^，。；！？]{2,30}?)(?=，|。|；|！|？|用于|面向|目标|包括|包含|在\d|$)/u.exec(
      rawInput,
    )
  if (!match?.[1]) {
    return null
  }
  const value = normalize(match[1])
  pushEntity(entities, rawInput, 'project_name', match[1], value, 0.88, match.index)
  return value
}

function extractObjectives(rawInput: string, entities: IntentEntity[]): string[] {
  const objectives: string[] = []
  const expression = /(?:目标是|目标为|为了|希望|旨在)\s*([^。；！？]{2,80})/gu
  for (const match of rawInput.matchAll(expression)) {
    const value = normalize(match[1] ?? '')
    if (!value) {
      continue
    }
    objectives.push(value)
    pushEntity(entities, rawInput, 'objective', match[1]!, value, 0.93, match.index)
  }
  return unique(objectives)
}

/** 「交付物」必须整体优先匹配：否则在「交付」处命中，切出「物包括架构设计」这类残片。 */
const DELIVERABLE_LEAD =
  /(?:交付物(?:包括|包含|为|有)?|包括|包含|交付|实现|完成)\s*([^。；！？]{2,120})/gu
/** 紧跟在日期之后的「完成」是时间节点描述（如「4 月中旬完成生产切换」），不是交付物清单。 */
const DATE_BEFORE_VERB = /(?:\d\s*[日号]|[上中下]旬|[月年]初|[月年]底|[月年]末|之前|以前)\s*$/u

function extractDeliverables(rawInput: string, entities: IntentEntity[]): string[] {
  const deliverables: string[] = []
  for (const match of rawInput.matchAll(DELIVERABLE_LEAD)) {
    const lead = match[0].slice(0, match[0].length - (match[1]?.length ?? 0))
    const before = rawInput.slice(Math.max(0, (match.index ?? 0) - 12), match.index)
    if (lead.startsWith('完成') && DATE_BEFORE_VERB.test(before)) continue
    const segment = match[1] ?? ''
    const parts = segment
      .split(/[、，,]|(?:以及)|(?:和)/u)
      .map(normalize)
      .filter((part) => part.length >= 2)
    for (const part of parts) {
      deliverables.push(part)
      pushEntity(entities, rawInput, 'deliverable', part, part, 0.9, match.index)
    }
  }
  return unique(deliverables)
}

function extractConstraints(rawInput: string, entities: IntentEntity[]): string[] {
  const constraints = rawInput
    .split(/[，,。！？；;\n]+/u)
    .map(normalize)
    .filter(
      (sentence) =>
        sentence.length >= 2 && /必须|不能|不得|要求|限制|预算|成本|合规|隐私|安全/u.test(sentence),
    )

  for (const constraint of constraints) {
    pushEntity(entities, rawInput, 'constraint', constraint, constraint, 0.92)
  }
  return unique(constraints)
}

function extractRoleEntities(rawInput: string): IntentEntity[] {
  const roles: IntentEntity[] = []
  const expression = /(?:面向|供|服务于)\s*([^，。；！？]{2,30}?)(?=使用|，|。|；|！|？|$)/gu
  for (const match of rawInput.matchAll(expression)) {
    const text = match[1]
    if (!text || match.index === undefined) {
      continue
    }
    const start = rawInput.indexOf(text, match.index)
    roles.push({
      type: 'role',
      value: normalize(text),
      text,
      start,
      end: start + text.length,
      confidence: 0.92,
      source: 'explicit',
    })
  }
  return roles
}

export default class IntentParserService {
  parse(rawValue: string): ParsedIntent {
    const rawInput = normalize(rawValue)
    const entities: IntentEntity[] = []
    const classification = classifyProjectType(rawInput)

    const isoDates = extractMatches(
      rawInput,
      /(?<year>20\d{2})\s*[-/.年]\s*(?<month>1[0-2]|0?[1-9])\s*[-/.月]\s*(?<day>3[01]|[12]\d|0?[1-9])\s*日?/gu,
      'start_date',
      toIsoDate,
    )
    for (const dateEntity of isoDates) {
      const prefix = rawInput.slice(Math.max(0, dateEntity.start - 8), dateEntity.start)
      const suffix = rawInput.slice(dateEntity.end, Math.min(rawInput.length, dateEntity.end + 8))
      if (
        /截止|完成|结束|上线|交付/u.test(prefix) ||
        /举办|举行|演出|表演|活动|会议|展会/u.test(suffix)
      ) {
        dateEntity.type = 'deadline'
      }
    }

    const monthDeadlines = extractMonthPhraseDeadlines(rawInput)
    const durations = extractMatches(
      rawInput,
      /(?<amount>\d{1,3})\s*个?\s*(?<unit>天|周|月|days?|weeks?|months?)/giu,
      'duration',
      durationInDays,
    )
      .filter(
        (duration) =>
          !isoDates.some((date) => duration.start >= date.start && duration.end <= date.end) &&
          !isCalendarMonth(rawInput, duration),
      )
      // 「周期 / 工期 / 为期」后的工期才是项目工期，排在最前供 timeline.durationDays 取用。
      .sort(
        (left, right) =>
          Number(isProjectDuration(rawInput, right)) - Number(isProjectDuration(rawInput, left)),
      )
    const teamSizes = extractTeamSizeEntities(rawInput)

    entities.push(
      ...isoDates,
      ...monthDeadlines.filter(
        (deadline) =>
          !isoDates.some((date) => date.type === 'deadline' || date.start === deadline.start),
      ),
      ...durations,
      ...teamSizes,
      ...extractRoleEntities(rawInput),
    )

    for (const technology of TECHNOLOGIES) {
      const lowerInput = rawInput.toLowerCase()
      let fromIndex = 0
      while (true) {
        const start = lowerInput.indexOf(technology.toLowerCase(), fromIndex)
        if (start < 0) {
          break
        }
        const text = rawInput.slice(start, start + technology.length)
        entities.push({
          type: 'technology',
          value: technology,
          text,
          start,
          end: start + text.length,
          confidence: 0.99,
          source: 'explicit',
        })
        fromIndex = start + text.length
      }
    }

    for (const platform of PLATFORMS) {
      pushEntity(entities, rawInput, 'platform', platform, platform, 0.94)
    }

    const projectName = extractProjectName(rawInput, entities)
    const objectives = extractObjectives(rawInput, entities)
    const deliverables = extractDeliverables(rawInput, entities)
    const constraints = extractConstraints(rawInput, entities)
    entities.sort((left, right) => left.start - right.start || left.type.localeCompare(right.type))

    const startDate = entities.find((entity) => entity.type === 'start_date')?.value
    const deadline = entities.find((entity) => entity.type === 'deadline')?.value
    const durationDays = durations[0]?.value
    const evidenceCount =
      Number(projectName !== null) +
      objectives.length +
      deliverables.length +
      entities.filter((entity) => entity.type !== 'constraint').length

    return {
      schemaVersion: AI_INTENT_SCHEMA_VERSION,
      projectType: classification.projectType,
      projectName,
      objectives,
      deliverables,
      timeline: {
        startDate: typeof startDate === 'string' ? startDate : null,
        deadline: typeof deadline === 'string' ? deadline : null,
        durationDays: typeof durationDays === 'number' ? durationDays : null,
      },
      constraints,
      entities,
      overallConfidence: clampConfidence(
        evidenceCount === 0
          ? Math.min(classification.confidence, 0.35)
          : (classification.confidence + Math.min(0.95, 0.5 + evidenceCount * 0.05)) / 2,
      ),
    }
  }
}
