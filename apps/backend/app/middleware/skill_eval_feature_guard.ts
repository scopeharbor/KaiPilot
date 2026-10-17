/**
 * v3-skill-eval-system —— feature-off 守卫中间件（D10）。
 *
 * flag 关闭时返回 404（不暴露数据），开启时放行。
 */
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'

/**
 * Skill 评估 feature flag 中间件。
 * COMPILER_SKILL_EVAL_ENABLED=true 才放行 eval 端点。
 */
export default class SkillEvalFeatureGuard {
  async handle(ctx: HttpContext, next: NextFn) {
    const enabled = env.get('COMPILER_SKILL_EVAL_ENABLED', false) as boolean

    if (!enabled) {
      return ctx.response.status(404).json({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Skill eval is not enabled',
        },
      })
    }

    return next()
  }
}
