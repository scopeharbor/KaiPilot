import Diagram from '#models/diagram'
import DiagramPolicy from '#policies/diagram_policy'
import DiagramService from '#services/diagram_service'
import MermaidExportService from '#services/mermaid_export_service'
import {
  createDiagramValidator,
  updateDiagramValidator,
  listDiagramsValidator,
} from '#validators/diagram'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { DiagramSpec } from '@aiproj/types'

@inject()
export default class DiagramsController {
  constructor(
    private diagramService: DiagramService,
    private mermaidExport: MermaidExportService,
    private policy: DiagramPolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private async findDiagramInOrg(
    organizationId: number,
    diagramId: number,
  ): Promise<Diagram | null> {
    return Diagram.query()
      .where('id', diagramId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(user, ctx.tenant!.organizationId, projectId)

    const filters = await ctx.request.validateUsing(listDiagramsValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.diagramService.list(ctx.tenant!.organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const diagramId = Number(ctx.params.id)
    const organizationId = ctx.tenant!.organizationId
    const diagram = await this.findDiagramInOrg(organizationId, diagramId)
    if (!diagram)
      return ctx.response.notFound({ error: { code: 'DIAGRAM_NOT_FOUND', message: '图表不存在' } })
    await this.policy.authorizeView(user, organizationId, diagram.projectId)
    return ctx.response.ok({ data: diagram })
  }

  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createDiagramValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(user, organizationId, projectId)

    const diagram = await this.diagramService.create(
      organizationId,
      projectId,
      { ...input, spec: input.spec as DiagramSpec },
      user.id,
      { requestId: ctx.request.id() ?? null },
    )
    return ctx.response.created({ data: diagram })
  }

  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateDiagramValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const diagramId = Number(ctx.params.id)

    const existing = await this.findDiagramInOrg(organizationId, diagramId)
    if (!existing)
      return ctx.response.notFound({ error: { code: 'DIAGRAM_NOT_FOUND', message: '图表不存在' } })

    await this.policy.authorizeManage(user, organizationId, existing.projectId)

    const updated = await this.diagramService.update(
      organizationId,
      existing.projectId,
      diagramId,
      { ...input, spec: input.spec as DiagramSpec | undefined },
      user.id,
      { requestId: ctx.request.id() ?? null },
    )
    return ctx.response.ok({ data: updated })
  }

  async destroy(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const diagramId = Number(ctx.params.id)
    const diagram = await this.findDiagramInOrg(organizationId, diagramId)
    if (!diagram)
      return ctx.response.notFound({ error: { code: 'DIAGRAM_NOT_FOUND', message: '图表不存在' } })

    await this.policy.authorizeManage(user, organizationId, diagram.projectId)

    await this.diagramService.softDelete(organizationId, diagram.projectId, diagramId, user.id, {
      requestId: ctx.request.id() ?? null,
    })
    return ctx.response.noContent()
  }

  async mermaid(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const diagramId = Number(ctx.params.id)
    const organizationId = ctx.tenant!.organizationId
    const diagram = await this.findDiagramInOrg(organizationId, diagramId)
    if (!diagram)
      return ctx.response.notFound({ error: { code: 'DIAGRAM_NOT_FOUND', message: '图表不存在' } })

    await this.policy.authorizeView(user, organizationId, diagram.projectId)

    const result = this.mermaidExport.export(diagram.spec)
    return ctx.response.ok({ data: result })
  }
}
