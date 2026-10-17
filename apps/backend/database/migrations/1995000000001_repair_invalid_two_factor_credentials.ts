import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 修复「标记为已启用、却没有可用密钥」的两步验证记录。
 *
 * 这类记录会把账号送进一个**永远过不了**的验证码页：服务端认为该用户已绑定，
 * 于是拦下登录要第二因子，但根本不存在能生成验证码的认证器。
 *
 * 迁移只处理**在 SQL 层面就能确定为坏数据**的一种：密文列为空串。
 * （列本身 notNullable，故不存在 NULL；空串是历史写入失败/手工改库的典型残留。）
 *
 * 刻意**不**在这里做「解不开就删」——迁移拿不到应用层的加密密钥，
 * 也无从区分「数据坏了」与「密钥配错了」。后者若按坏数据清理，一次配置失误
 * 就会抹掉全站第二因子。运行期由 `TwoFactorService.resolveState()` 承担该判定：
 * 结构损坏 → 自动退回未绑定并审计；密钥不匹配 → fail closed 抛 503，绝不清理。
 *
 * 处置方式是**整行删除**而非改状态：留着一条没有密钥的凭据没有任何用途，
 * 删掉即等价于「未绑定」，用户下次登录走正常绑定流程。恢复码与在途挑战一并清理——
 * 它们依附于一个已不存在的第二因子。
 *
 * 幂等：可重复执行；对已完成绑定的正常账号零影响（它们的密文非空）。
 * 不可逆：`down()` 不恢复——被删的记录本来就无法使用，「恢复」它等于重新制造故障。
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      const rows = await db
        .from('user_two_factor_credentials')
        .where('status', 'active')
        .where((query) => {
          query.where('secret_encrypted', '').orWhereNull('secret_encrypted')
        })
        .select('user_id')

      const userIds = rows.map((row: { user_id: number }) => row.user_id)
      if (userIds.length === 0) return

      // 先清子表再删主记录：恢复码与在途挑战都依附于这条已不可用的凭据。
      await db.from('user_two_factor_recovery_codes').whereIn('user_id', userIds).delete()
      await db.from('user_two_factor_challenges').whereIn('user_id', userIds).delete()
      await db.from('user_two_factor_credentials').whereIn('user_id', userIds).delete()
    })
  }

  async down() {
    // 无法回滚：被清理的记录不含可用密钥，恢复它只会重新制造「账号卡死」。
  }
}
