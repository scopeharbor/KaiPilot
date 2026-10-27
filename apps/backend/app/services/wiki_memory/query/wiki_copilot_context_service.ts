/**
 * v3-llm-wiki-rag-retirement —— AI 同事回合的维基记忆（design D1）。
 *
 * 组织已开启维基、提问者有 `wiki:view` 时，以提问者身份装配维基上下文包（按权限遮蔽、字节预算、确定性），
 * 供 Copilot 回答提示使用；同一个包交给影子观测记录统计（不重复装配）。
 * 环境变量 WIKI_CONTEXT_INJECT=off 时不装配；任何失败返回 null 并只记日志，不影响回合。
 * 代号化与 DLP 预检在回答提示组装处进行（与其他上下文同一条路径）。
 */
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import {
  WIKI_MEMORY_INSTRUCTION,
  wikiMemoryForModel,
  type WikiContextPackDto,
  type WikiMemoryForModel,
} from '@aiproj/types'
import User from '#models/user'
import type { WikiActor } from '../wiki_access_service.js'
import WikiContextPackBuilder from './wiki_context_pack_builder.js'
import WikiQueryService from './wiki_query_service.js'

export const WIKI_CONTEXT_INJECT_ENV = 'WIKI_CONTEXT_INJECT'

export function wikiContextInjectEnabled(): boolean {
  return (process.env[WIKI_CONTEXT_INJECT_ENV] ?? '').trim().toLowerCase() !== 'off'
}

export interface WikiCopilotContextInput {
  organizationId: number
  actorId: number
  projectId: number | null
  query: string
}

@inject()
export default class WikiCopilotContextService {
  constructor(
    private readonly builder: WikiContextPackBuilder,
    private readonly query: WikiQueryService,
  ) {}

  /** 本回合交给模型的维基上下文包；不可用、关闭或失败时为 null。 */
  async build(input: WikiCopilotContextInput): Promise<WikiContextPackDto | null> {
    try {
      if (!wikiContextInjectEnabled()) return null
      const user = await User.find(input.actorId)
      if (!user) return null
      const actor: WikiActor = { user, organizationId: input.organizationId }
      if (!(await this.query.isAvailable(actor))) return null
      return await this.builder.build(actor, { projectId: input.projectId, query: input.query })
    } catch (error) {
      logger.warn(
        { organizationId: input.organizationId, err: (error as Error).name },
        'wiki copilot context failed',
      )
      return null
    }
  }
}

export interface WikiMemoryPromptSection {
  wikiMemory: WikiMemoryForModel[]
  instruction: string
}

/**
 * 把本回合的维基上下文包变成回答提示的一段：姓名改写为代号 → DLP 预检（不放行则整段不给）→ 维基记忆与说明。
 * 包为空或预检不放行时返回 null（回答提示与未开启维基时相同）。
 */
export async function prepareWikiMemoryForPrompt(
  pack: WikiContextPackDto | null,
  opts: {
    rewrite: (text: string) => string
    /** 返回 true 表示放行（不可用、不放行、要求脱敏都应返回 false）。 */
    preflight: (serialized: string, itemCount: number) => Promise<boolean>
  },
): Promise<WikiMemoryPromptSection | null> {
  if (!pack) return null
  const wikiMemory = wikiMemoryForModel(pack, opts.rewrite)
  if (wikiMemory.length === 0) return null
  const itemCount = wikiMemory.reduce((n, p) => n + p.claims.length, 0)
  let allowed = false
  try {
    allowed = await opts.preflight(JSON.stringify(wikiMemory), itemCount)
  } catch {
    allowed = false
  }
  return allowed ? { wikiMemory, instruction: WIKI_MEMORY_INSTRUCTION } : null
}
