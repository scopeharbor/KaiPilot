/**
 * 可由 AI 同事用自然语言修改的设置目录（日历第 4 批）。
 *
 * 每一项声明：key、显示名、层级（个人 / 项目 / 组织）、取值说明、读当前值、校验并解析新值、
 * 写入（复用既有 Service，沿用它们的审计）与写权限。
 * - 个人项只改自己的；项目项需要项目编辑权限；组织项需要组织管理权限（再由 Service 校验一次）；
 * - 密码、两步验证、AI 连接密钥、KMS、SSO、集成凭据等敏感设置不在目录里：AI 同事只带用户去对应页面；
 * - 这里只提供「预览差异」与「按预览令牌提交」，提交前必须经用户确认（AI 只建议、不自动执行）。
 */
import { createHash } from 'node:crypto'
import { inject } from '@adonisjs/core'
import {
  CALENDAR_SYSTEM_IDS,
  CALENDAR_SYSTEM_LABELS,
  normalizeCalendarSystems,
  normalizePersonalCalendar,
  type CalendarSystemId,
  type PersonalWorkingCalendar,
} from '@aiproj/types'
import Organization from '#models/organization'
import Project from '#models/project'
import User from '#models/user'
import OrganizationPolicy from '#policies/organization_policy'
import ProjectPolicy from '#policies/project_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import CalendarDisplayService from '#services/calendar/calendar_display_service'
import PersonalCalendarService from '#services/calendar/personal_calendar_service'
import OrganizationService from '#services/organization_service'
import ProjectService from '#services/project_service'
import UserService from '#services/user_service'
import {
  ConflictException,
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'

export type SettingLayer = 'personal' | 'project' | 'organization'

export const SETTING_LAYER_LABELS: Record<SettingLayer, string> = {
  personal: '个人',
  project: '项目',
  organization: '组织',
}

export interface SettingContext {
  user: User
  organizationId: number
  projectId: number | null
  requestId: string | null
}

interface SettingDefinition<V> {
  key: string
  label: string
  layer: SettingLayer
  /** 给模型看的取值说明。 */
  valueHint: string
  /** 当前值含真实姓名等个人信息：不给模型看（模型只认成员代号）。 */
  hideCurrentFromModel?: boolean
  read(ctx: SettingContext): Promise<V>
  /** 校验并解析模型 / 用户给的新值（不合法抛 ValidationException）。 */
  parse(raw: unknown, current: V): V
  format(value: V): string
  canWrite(ctx: SettingContext): Promise<boolean>
  write(ctx: SettingContext, value: V): Promise<void>
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function systemsText(systems: readonly CalendarSystemId[] | null): string {
  if (!systems || systems.length === 0) return '跟随上一层设定'
  return systems.map((id) => CALENDAR_SYSTEM_LABELS[id]).join(' → ')
}

function parseSystems(raw: unknown): CalendarSystemId[] | null {
  if (raw === null || raw === 'inherit' || raw === '') return null
  const systems = normalizeCalendarSystems(raw)
  if (!systems) {
    throw new ValidationException(`曆法只能从这些里选：${CALENDAR_SYSTEM_IDS.join('、')}`)
  }
  return systems
}

function parseText(raw: unknown, max: number, label: string, allowEmpty = false): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text && !allowEmpty) throw new ValidationException(`${label}不能为空`)
  if (text.length > max) throw new ValidationException(`${label}不能超过 ${max} 字`)
  return text
}

function parseDate(raw: unknown, label: string): string | null {
  if (raw === null || raw === '') return null
  if (typeof raw !== 'string' || !ISO.test(raw)) {
    throw new ValidationException(`${label}要是 YYYY-MM-DD 格式`)
  }
  return raw
}

function leavesText(calendar: PersonalWorkingCalendar): string {
  if (calendar.leaves.length === 0) return '没有休假'
  return calendar.leaves
    .map((leave) => `${leave.startDate}～${leave.endDate}${leave.note ? `（${leave.note}）` : ''}`)
    .join('；')
}

function workdaysText(calendar: PersonalWorkingCalendar): string {
  if (!calendar.workdays) return '跟随项目'
  return [...calendar.workdays]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((day) => WEEKDAY_NAMES[day])
    .join('、')
}

async function loadProject(ctx: SettingContext): Promise<Project> {
  if (!ctx.projectId) throw new ValidationException('要改哪个项目？请先进入项目或说出项目名')
  const project = await Project.query()
    .where('id', ctx.projectId)
    .where('organization_id', ctx.organizationId)
    .whereNull('deleted_at')
    .first()
  if (!project) throw new ResourceNotFoundException('项目不存在')
  return project
}

@inject()
export default class SettingsCatalogService {
  constructor(
    private calendarDisplay: CalendarDisplayService,
    private personalCalendar: PersonalCalendarService,
    private projects: ProjectService,
    private organizations: OrganizationService,
    private users: UserService,
    private projectPolicy: ProjectPolicy,
    private organizationPolicy: OrganizationPolicy,
    private audit: AuditService,
  ) {}

  private definitions(): Array<SettingDefinition<any>> {
    const own = async () => true
    const projectEditor = (ctx: SettingContext) =>
      ctx.projectId
        ? this.projectPolicy.update(ctx.user, ctx.organizationId, ctx.projectId)
        : Promise.resolve(false)
    const orgManager = (ctx: SettingContext) =>
      this.organizationPolicy.manage(ctx.user, ctx.organizationId).then(Boolean)
    const calendarLayer = (
      layer: SettingLayer,
      key: string,
      label: string,
      canWrite: (ctx: SettingContext) => Promise<boolean>,
    ): SettingDefinition<CalendarSystemId[] | null> => ({
      key,
      label,
      layer,
      valueHint: `曆法 id 的有序数组（第一个能排月份的是主曆）：${CALENDAR_SYSTEM_IDS.join('|')}；null 表示清除、跟随上一层`,
      read: async (ctx) => {
        const resolved = await this.calendarDisplay.resolve(
          ctx.user,
          ctx.organizationId,
          layer === 'personal' ? null : (ctx.projectId ?? null),
        )
        return resolved.layers[layer]
      },
      parse: (raw) => parseSystems(raw),
      format: systemsText,
      canWrite,
      write: async (ctx, value) => {
        await this.calendarDisplay.update(
          ctx.user,
          ctx.organizationId,
          layer,
          value,
          ctx.projectId ?? null,
          { requestId: ctx.requestId ?? undefined },
        )
      },
    })

    const personalCalendarItem = (
      key: string,
      label: string,
      valueHint: string,
      parse: (raw: unknown, current: PersonalWorkingCalendar) => PersonalWorkingCalendar,
      format: (value: PersonalWorkingCalendar) => string,
    ): SettingDefinition<PersonalWorkingCalendar> => ({
      key,
      label,
      layer: 'personal',
      valueHint,
      read: async (ctx) => this.personalCalendar.get(await User.findOrFail(ctx.user.id)),
      parse,
      format,
      canWrite: own,
      write: async (ctx, value) => {
        await this.personalCalendar.update(ctx.user, ctx.organizationId, value, {
          requestId: ctx.requestId ?? undefined,
        })
      },
    })

    return [
      calendarLayer('personal', 'calendar.systems.personal', '我的日历曆法', own),
      calendarLayer('project', 'calendar.systems.project', '项目日历曆法', projectEditor),
      calendarLayer(
        'organization',
        'calendar.systems.organization',
        '组织默认日历曆法',
        orgManager,
      ),
      personalCalendarItem(
        'personal.leave.add',
        '我的休假（新增一段）',
        '{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","note":"可选说明"}',
        (raw, current) => {
          const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
          const start = parseDate(record.startDate, '开始日期')
          const end = parseDate(record.endDate ?? record.startDate, '结束日期')
          if (!start || !end) throw new ValidationException('要给出休假的起止日期')
          const note = typeof record.note === 'string' ? record.note : null
          return normalizePersonalCalendar({
            workdays: current.workdays,
            leaves: [...current.leaves, { startDate: start, endDate: end, note }],
          })
        },
        leavesText,
      ),
      personalCalendarItem(
        'personal.leave.remove',
        '我的休假（取消一段）',
        '{"date":"YYYY-MM-DD"}：取消包含这天的那段休假',
        (raw, current) => {
          const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
          const day = parseDate(record.date ?? record.startDate, '日期')
          if (!day) throw new ValidationException('要说出取消哪一天的休假')
          const kept = current.leaves.filter(
            (leave) => !(leave.startDate <= day && leave.endDate >= day),
          )
          if (kept.length === current.leaves.length) {
            throw new ValidationException(`${day} 没有登记休假`)
          }
          return { workdays: current.workdays, leaves: kept }
        },
        leavesText,
      ),
      personalCalendarItem(
        'personal.workdays',
        '我的个人工作日',
        '工作日数组（0=周日 … 6=周六），null 表示跟随项目',
        (raw, current) => {
          if (raw === null || raw === 'inherit') return { workdays: null, leaves: current.leaves }
          if (!Array.isArray(raw)) throw new ValidationException('工作日要给 0–6 的数组')
          return normalizePersonalCalendar({ workdays: raw, leaves: current.leaves })
        },
        workdaysText,
      ),
      {
        key: 'personal.full_name',
        label: '我的显示名称',
        layer: 'personal',
        valueHint: '字符串，1–100 字',
        hideCurrentFromModel: true,
        read: (ctx) => User.findOrFail(ctx.user.id).then((row) => row.fullName ?? ''),
        parse: (raw) => parseText(raw, 100, '显示名称'),
        format: (value: string) => value || '（未设）',
        canWrite: own,
        write: async (ctx, value: string) => {
          await this.users.update(ctx.user.id, { fullName: value }, ctx.user.id, {
            requestId: ctx.requestId ?? undefined,
          })
        },
      },
      {
        key: 'project.name',
        label: '项目名称',
        layer: 'project',
        valueHint: '字符串，1–255 字',
        read: (ctx) => loadProject(ctx).then((row) => row.name),
        parse: (raw) => parseText(raw, 255, '项目名称'),
        format: (value: string) => value,
        canWrite: projectEditor,
        write: async (ctx, value: string) => {
          await this.projects.update(
            ctx.organizationId,
            ctx.projectId!,
            { name: value },
            ctx.user.id,
            {
              requestId: ctx.requestId ?? undefined,
            },
          )
        },
      },
      {
        key: 'project.description',
        label: '项目描述',
        layer: 'project',
        valueHint: '字符串，0–2000 字',
        read: (ctx) => loadProject(ctx).then((row) => row.description ?? ''),
        parse: (raw) => parseText(raw, 2000, '项目描述', true),
        format: (value: string) => value || '（空）',
        canWrite: projectEditor,
        write: async (ctx, value: string) => {
          await this.projects.update(
            ctx.organizationId,
            ctx.projectId!,
            { description: value || null },
            ctx.user.id,
            { requestId: ctx.requestId ?? undefined },
          )
        },
      },
      {
        key: 'project.start_date',
        label: '项目开始日期',
        layer: 'project',
        valueHint: 'YYYY-MM-DD',
        read: (ctx) => loadProject(ctx).then((row) => row.startDate?.toISODate() ?? null),
        parse: (raw) => parseDate(raw, '开始日期'),
        format: (value: string | null) => value ?? '（未设）',
        canWrite: projectEditor,
        write: async (ctx, value: string | null) => {
          await this.projects.update(
            ctx.organizationId,
            ctx.projectId!,
            { startDate: value },
            ctx.user.id,
            { requestId: ctx.requestId ?? undefined },
          )
        },
      },
      {
        key: 'project.end_date',
        label: '项目结束日期',
        layer: 'project',
        valueHint: 'YYYY-MM-DD',
        read: (ctx) => loadProject(ctx).then((row) => row.endDate?.toISODate() ?? null),
        parse: (raw) => parseDate(raw, '结束日期'),
        format: (value: string | null) => value ?? '（未设）',
        canWrite: projectEditor,
        write: async (ctx, value: string | null) => {
          await this.projects.update(
            ctx.organizationId,
            ctx.projectId!,
            { endDate: value },
            ctx.user.id,
            { requestId: ctx.requestId ?? undefined },
          )
        },
      },
      {
        key: 'organization.name',
        label: '组织名称',
        layer: 'organization',
        valueHint: '字符串，1–255 字',
        read: (ctx) => Organization.findOrFail(ctx.organizationId).then((row) => row.name),
        parse: (raw) => parseText(raw, 255, '组织名称'),
        format: (value: string) => value,
        canWrite: orgManager,
        write: async (ctx, value: string) => {
          await this.organizations.update(
            ctx.organizationId,
            { name: value },
            ctx.user.id,
            ctx.organizationId,
            false,
            { requestId: ctx.requestId ?? undefined },
          )
        },
      },
      {
        key: 'organization.description',
        label: '组织简介',
        layer: 'organization',
        valueHint: '字符串，0–2000 字',
        read: (ctx) =>
          Organization.findOrFail(ctx.organizationId).then((row) => row.description ?? ''),
        parse: (raw) => parseText(raw, 2000, '组织简介', true),
        format: (value: string) => value || '（空）',
        canWrite: orgManager,
        write: async (ctx, value: string) => {
          await this.organizations.update(
            ctx.organizationId,
            { description: value || null },
            ctx.user.id,
            ctx.organizationId,
            false,
            { requestId: ctx.requestId ?? undefined },
          )
        },
      },
    ]
  }

  private find(key: string): SettingDefinition<any> {
    const definition = this.definitions().find((item) => item.key === key)
    if (!definition) throw new ResourceNotFoundException(`没有这项可改的设置：${key}`)
    return definition
  }

  /** 给模型看的目录：当前上下文里有意义的项与当前值、能不能改。 */
  async listForPlanner(ctx: SettingContext): Promise<
    Array<{
      key: string
      label: string
      layer: SettingLayer
      current: string
      valueHint: string
      writable: boolean
    }>
  > {
    const rows = []
    for (const definition of this.definitions()) {
      if (definition.layer === 'project' && !ctx.projectId) continue
      try {
        const current = definition.hideCurrentFromModel
          ? '（不显示）'
          : definition.format(await definition.read(ctx))
        rows.push({
          key: definition.key,
          label: definition.label,
          layer: definition.layer,
          current,
          valueHint: definition.valueHint,
          writable: await definition.canWrite(ctx),
        })
      } catch {
        // 读不到（如项目不存在）就不给模型看这一项
      }
    }
    return rows
  }

  /** 预览：校验权限与新值，给出前后差异和令牌（零写入）。 */
  async preview(ctx: SettingContext, key: string, raw: unknown) {
    const definition = this.find(key)
    if (!(await definition.canWrite(ctx))) {
      throw new PermissionDeniedException(
        `没有修改「${definition.label}」的权限（需要${definition.layer === 'project' ? '项目编辑' : definition.layer === 'organization' ? '组织管理' : '本人'}权限）`,
      )
    }
    const current = await definition.read(ctx)
    const next = definition.parse(raw, current)
    const beforeText = definition.format(current)
    const afterText = definition.format(next)
    return {
      key,
      label: definition.label,
      layer: definition.layer,
      layerLabel: SETTING_LAYER_LABELS[definition.layer],
      projectId: definition.layer === 'project' ? ctx.projectId : null,
      beforeText,
      afterText,
      noop: JSON.stringify(current) === JSON.stringify(next),
      previewToken: settingPreviewToken(ctx, key, current, next),
    }
  }

  /** 提交：重算令牌（预览后被别人改过 → 409），写入并记审计。 */
  async apply(ctx: SettingContext, key: string, raw: unknown, previewToken: string) {
    const definition = this.find(key)
    if (!(await definition.canWrite(ctx))) {
      throw new PermissionDeniedException(`没有修改「${definition.label}」的权限`)
    }
    const current = await definition.read(ctx)
    const next = definition.parse(raw, current)
    if (settingPreviewToken(ctx, key, current, next) !== previewToken) {
      throw new ConflictException('这项设置在预览后已被修改，请重新预览')
    }
    await definition.write(ctx, next)
    await this.audit.log({
      event: AuditEvent.AI_SETTING_CHANGED,
      userId: ctx.user.id,
      organizationId: ctx.organizationId,
      projectId: definition.layer === 'project' ? ctx.projectId : null,
      entityType: definition.layer === 'personal' ? 'user' : definition.layer,
      entityId:
        definition.layer === 'personal'
          ? ctx.user.id
          : definition.layer === 'project'
            ? (ctx.projectId ?? 0)
            : ctx.organizationId,
      requestId: ctx.requestId,
      changes: { before: { value: current }, after: { value: next } },
      metadata: { key, source: 'ai-colleague', confirmedByUser: true },
    })
    return {
      key,
      label: definition.label,
      layer: definition.layer,
      layerLabel: SETTING_LAYER_LABELS[definition.layer],
      beforeText: definition.format(current),
      afterText: definition.format(next),
      committed: true,
    }
  }
}

export function settingPreviewToken(
  ctx: SettingContext,
  key: string,
  current: unknown,
  next: unknown,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        tool: 'update_setting',
        userId: ctx.user.id,
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        key,
        current,
        next,
      }),
    )
    .digest('hex')
}
