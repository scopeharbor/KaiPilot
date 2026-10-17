/**
 * 应用自有 ace 命令的显式加载器（在 adonisrc `commands` 中登记）。
 *
 * 为什么不放进 `commands/` 目录让 FsLoader 自动扫描：FsLoader 会用 jsonschema 校验命令元数据，
 * 生产镜像（node:24-bookworm-slim）里 jsonschema 1.5 的 `new URL(undefined, 'resolve://')`
 * 解析失败，任何经 FsLoader 的应用命令都报「Invalid command exported ... Invalid URL」
 * （本机 Node 不复现）。rcFile 登记的加载器不经该校验——与 `migration:run` 等内置命令同一路径。
 *
 * 形状与 `@adonisjs/core/commands` 的加载器一致：getMetaData / getCommand。
 */
import AdminCreateSuperCommand from './admin_create_super.js'
import AiDraftEvalCommand from './ai_draft_eval.js'
import AiRecordsPurgeCommand from './ai_records_purge.js'
import UserCreateCommand from './user_create.js'

const COMMANDS = [
  AdminCreateSuperCommand,
  AiDraftEvalCommand,
  AiRecordsPurgeCommand,
  UserCreateCommand,
]

export async function getMetaData() {
  return COMMANDS.map((command) => command.serialize())
}

export async function getCommand(metaData: { commandName: string }) {
  return COMMANDS.find((command) => command.commandName === metaData.commandName) ?? null
}
