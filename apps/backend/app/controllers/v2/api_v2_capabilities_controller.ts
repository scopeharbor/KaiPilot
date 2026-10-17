/**
 * API v2 能力发现控制器
 *
 * 返回已准入的 v2 路由元数据（不含 secret、内部路径或实现细节）。
 */
import type { HttpContext } from '@adonisjs/core/http'
import { V2_ROUTE_ADMISSION_MANIFEST, validateAdmissionManifest } from '#types/api_v2_admission'

export default class ApiV2CapabilitiesController {
  /**
   * GET /api/v2/capabilities
   *
   * 返回公开的 v2 端点列表。只暴露 id、method、path、sourceCapability、
   * contractVersion、status；不暴露内部文件路径、fallback 细节或实现信息。
   */
  async index({ response }: HttpContext) {
    const { valid, errors } = validateAdmissionManifest()
    if (!valid) {
      return response.status(500).json({
        error: {
          code: 'ADMISSION_MANIFEST_INVALID',
          message: '准入清单校验失败，请检查 manifest',
          details: errors,
        },
      })
    }

    const admitted = V2_ROUTE_ADMISSION_MANIFEST.filter(
      (e) => e.status === 'admitted' || e.status === 'experimental',
    ).map((e) => ({
      id: e.id,
      method: e.method,
      path: e.path,
      sourceCapability: e.sourceCapability,
      contractVersion: e.contractVersion,
      status: e.status,
    }))

    return response.ok({
      version: '2',
      apiV2Enabled: true,
      endpoints: admitted,
      total: admitted.length,
    })
  }
}
