import type { HttpContext } from '@adonisjs/core/http'
import { FeatureDisabledException } from '#exceptions/api_exception'

/**
 * 多项目依赖（CRUD + Detection）feature flag 中间件——只挂在这两个路由组上，
 * Impact Analysis 路由组未挂本 guard（见 start/routes.ts 的组级挂载）。
 * v3-multi-project-dependency-model/crud/detection/impact-analysis
 *
 * 关闭后隐藏入口或返回不可用响应，保留已写入数据，
 * 不影响 task_dependencies、甘特、PMO Dashboard、资源、OKR、BI 等。
 */
export default class MultiProjectDependencyFeatureGuard {
  public async handle(_ctx: HttpContext, next: () => Promise<void>) {
    const enabled = process.env.FEATURE_MPD_CRUD === 'true'
    if (!enabled) {
      throw new FeatureDisabledException('multi-project-dependencies')
    }
    await next()
  }
}
