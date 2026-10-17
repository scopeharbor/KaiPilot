/**
 * 日历曆法显示设定（三层：组织 → 项目 → 个人，生效优先序 个人 > 项目 > 组织 > 系统默认）。
 *
 * 存放：组织 organizations.settings.calendarDisplay、项目 projects.settings.calendarDisplay、
 * 个人 users.preferences.calendarDisplay，值均为有序曆法 id 列表；null = 未设定（继承上层）。
 * 纯显示设定，不影响任务日期与排期；每次修改记审计。
 */
import { inject } from '@adonisjs/core'
import {
  normalizeCalendarSystems,
  resolveCalendarDisplay,
  type CalendarDisplayLayer,
  type CalendarDisplayLayers,
  type CalendarDisplayResolution,
  type CalendarSystemId,
} from '@aiproj/types'
import Organization from '#models/organization'
import Project from '#models/project'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import type { AuthContext } from '#types/auth'
import OrganizationPolicy from '#policies/organization_policy'
import ProjectPolicy from '#policies/project_policy'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'

const KEY = 'calendarDisplay'

function readLayer(source: Record<string, unknown> | null | undefined): CalendarSystemId[] | null {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[KEY]
  const systems =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { systems?: unknown }).systems
      : value
  return normalizeCalendarSystems(systems)
}

function writeLayer(
  source: Record<string, unknown> | null | undefined,
  systems: CalendarSystemId[] | null,
): Record<string, unknown> {
  const next = { ...(source ?? {}) }
  if (systems === null) delete next[KEY]
  else next[KEY] = { systems }
  return next
}

@inject()
export default class CalendarDisplayService {
  constructor(
    private audit: AuditService,
    private organizationPolicy: OrganizationPolicy,
    private projectPolicy: ProjectPolicy,
  ) {}

  private async loadProject(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  /** 生效设定 + 各层原值 + 当前用户可改哪些层。 */
  async resolve(
    user: User,
    organizationId: number,
    projectId: number | null,
  ): Promise<CalendarDisplayResolution> {
    const organization = await Organization.findOrFail(organizationId)
    let project: Project | null = null
    if (projectId !== null) {
      if (!(await this.projectPolicy.view(user, organizationId, projectId))) {
        throw new PermissionDeniedException('无权查看该项目')
      }
      project = await this.loadProject(organizationId, projectId)
    }
    const layers: CalendarDisplayLayers = {
      organization: readLayer(organization.settings),
      project: project ? readLayer(project.settings) : null,
      personal: readLayer(user.preferences),
    }
    return {
      ...resolveCalendarDisplay(layers),
      layers,
      editable: {
        personal: true,
        project: project
          ? await this.projectPolicy.update(user, organizationId, project.id)
          : false,
        organization: await this.organizationPolicy.manage(user, organizationId),
      },
    }
  }

  /** 改某一层（systems=null 表示清除、改为继承上层）。返回修改后的生效结果。 */
  async update(
    user: User,
    organizationId: number,
    layer: CalendarDisplayLayer,
    rawSystems: unknown,
    projectId: number | null,
    ctx: AuthContext = {},
  ): Promise<CalendarDisplayResolution> {
    const systems = rawSystems === null ? null : normalizeCalendarSystems(rawSystems)
    let before: CalendarSystemId[] | null
    let entityType: 'user' | 'project' | 'organization'
    let entityId: number
    if (layer === 'personal') {
      const fresh = await User.findOrFail(user.id)
      before = readLayer(fresh.preferences)
      fresh.preferences = writeLayer(fresh.preferences, systems)
      await fresh.save()
      user.preferences = fresh.preferences
      entityType = 'user'
      entityId = user.id
    } else if (layer === 'project') {
      if (projectId === null) throw new ResourceNotFoundException('缺少项目')
      if (!(await this.projectPolicy.update(user, organizationId, projectId))) {
        throw new PermissionDeniedException('无权修改该项目的日历设定')
      }
      const project = await this.loadProject(organizationId, projectId)
      before = readLayer(project.settings)
      project.settings = writeLayer(project.settings, systems)
      await project.save()
      entityType = 'project'
      entityId = project.id
    } else {
      if (!(await this.organizationPolicy.manage(user, organizationId))) {
        throw new PermissionDeniedException('需要组织管理权限才能修改组织默认日历')
      }
      const organization = await Organization.findOrFail(organizationId)
      before = readLayer(organization.settings)
      organization.settings = writeLayer(organization.settings, systems)
      await organization.save()
      entityType = 'organization'
      entityId = organization.id
    }
    await this.audit.log({
      event: AuditEvent.CALENDAR_DISPLAY_UPDATED,
      userId: user.id,
      organizationId,
      projectId: layer === 'project' ? projectId : null,
      entityType,
      entityId,
      requestId: ctx.requestId ?? null,
      changes: { before: { systems: before }, after: { systems } },
      metadata: { layer },
    })
    return this.resolve(user, organizationId, projectId)
  }
}
