import Diagram from '#models/diagram'
import Project from '#models/project'
import AuditService, { AuditEvent } from '#services/audit_service'
import { validateDiagramSpec } from '#services/diagram_spec_validator'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import type { AuthContext } from '#types/auth'
import type { DiagramSpec, DiagramType } from '@aiproj/types'
import { createHash } from 'node:crypto'

export interface CreateDiagramInput {
  type: DiagramType
  title: string
  spec: DiagramSpec
}

export interface UpdateDiagramInput {
  title?: string
  spec?: DiagramSpec
}

export interface DiagramListFilters {
  type?: DiagramType
  sort?: string
  page?: number
  perPage?: number
}

function computeSourceHash(spec: DiagramSpec): string {
  return createHash('sha256').update(JSON.stringify(spec.data)).digest('hex').slice(0, 128)
}

@inject()
export default class DiagramService {
  constructor(private audit: AuditService) {}

  async list(
    organizationId: number,
    projectId: number,
    filters: DiagramListFilters = {},
  ): Promise<{
    data: Diagram[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 20
    const query = Diagram.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (filters.type) query.where('type', filters.type)

    const sort = filters.sort ?? '-created_at'
    const desc = sort.startsWith('-')
    const sortField = sort.replace(/^-/, '')
    const allowedSorts = ['type', 'title', 'created_at', 'updated_at']
    if (allowedSorts.includes(sortField)) {
      query.orderBy(sortField, desc ? 'desc' : 'asc')
    } else {
      query.orderBy('created_at', 'desc')
    }

    const result = await query.paginate(page, perPage)
    return {
      data: result.all(),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  async show(organizationId: number, projectId: number, diagramId: number): Promise<Diagram> {
    const diagram = await this.diagramOrFail(organizationId, projectId, diagramId)
    return diagram
  }

  async create(
    organizationId: number,
    projectId: number,
    input: CreateDiagramInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Diagram> {
    await this.projectOrFail(organizationId, projectId)
    const validatedSpec = validateDiagramSpec(input.spec)

    const diagram = await Diagram.create({
      organizationId,
      projectId,
      type: input.type,
      title: input.title,
      spec: validatedSpec,
      sourceHash: computeSourceHash(validatedSpec),
      createdBy: actorUserId,
      updatedBy: actorUserId,
    })

    await this.audit.log({
      event: AuditEvent.DIAGRAM_CREATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'diagram',
      entityId: diagram.id,
      metadata: { type: diagram.type, title: diagram.title },
      requestId: ctx.requestId ?? null,
    })

    return diagram
  }

  async update(
    organizationId: number,
    projectId: number,
    diagramId: number,
    input: UpdateDiagramInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Diagram> {
    const diagram = await this.diagramOrFail(organizationId, projectId, diagramId)

    if (input.title !== undefined) diagram.title = input.title
    if (input.spec !== undefined) {
      const validatedSpec = validateDiagramSpec(input.spec)
      diagram.spec = validatedSpec
      diagram.sourceHash = computeSourceHash(validatedSpec)
    }
    diagram.updatedBy = actorUserId
    await diagram.save()

    await this.audit.log({
      event: AuditEvent.DIAGRAM_UPDATED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'diagram',
      entityId: diagram.id,
      metadata: { type: diagram.type, title: diagram.title },
      requestId: ctx.requestId ?? null,
    })

    return diagram
  }

  async softDelete(
    organizationId: number,
    projectId: number,
    diagramId: number,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<void> {
    const diagram = await this.diagramOrFail(organizationId, projectId, diagramId)
    diagram.deletedAt = DateTime.now()
    diagram.updatedBy = actorUserId
    await diagram.save()

    await this.audit.log({
      event: AuditEvent.DIAGRAM_DELETED,
      userId: actorUserId,
      organizationId,
      projectId,
      entityType: 'diagram',
      entityId: diagram.id,
      metadata: { type: diagram.type, title: diagram.title },
      requestId: ctx.requestId ?? null,
    })
  }

  async exportMermaid(
    organizationId: number,
    projectId: number,
    diagramId: number,
  ): Promise<{ mermaid: string; warnings: string[] }> {
    await this.diagramOrFail(organizationId, projectId, diagramId)
    // Mermaid export is handled by MermaidExportService, called from controller
    return { mermaid: '', warnings: [] }
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async diagramOrFail(
    organizationId: number,
    projectId: number,
    diagramId: number,
  ): Promise<Diagram> {
    const diagram = await Diagram.query()
      .where('id', diagramId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()
    if (!diagram) throw new ResourceNotFoundException('图表不存在')
    return diagram
  }
}
