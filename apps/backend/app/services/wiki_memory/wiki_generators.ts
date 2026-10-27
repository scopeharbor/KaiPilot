/**
 * v3-llm-wiki-memory-foundation —— 已登记的确定性派生生成器。
 *
 * 只有这里登记的生成器 ID 才能：①作为 `derived_query#<id>` 来源被引用；②以系统作者
 * 身份改写 `<!-- derived:<id> -->` 派生段并按簿记修改自动发布；③系统新建纯派生页时按簿记发布。
 * v3-llm-wiki-planning-dossier 登记参照类与打法两个生成器；v3-llm-wiki-process-reality 登记任务流转与变更审批两个流程生成器；
 * v3-llm-wiki-person-space 登记个人估算校准生成器；v3-llm-wiki-retrospective-lessons 登记结项复盘生成器。
 */
import {
  WIKI_PERSON_ESTIMATE_GENERATOR,
  WIKI_PLAYBOOK_GENERATOR,
  WIKI_PROCESS_CHANGE_APPROVAL_GENERATOR,
  WIKI_PROCESS_TASK_FLOW_GENERATOR,
  WIKI_REFERENCE_CLASS_GENERATOR,
  WIKI_RETROSPECTIVE_GENERATOR,
} from '@aiproj/types'

export const WIKI_REGISTERED_GENERATORS: ReadonlySet<string> = new Set<string>([
  WIKI_REFERENCE_CLASS_GENERATOR,
  WIKI_PLAYBOOK_GENERATOR,
  WIKI_PROCESS_TASK_FLOW_GENERATOR,
  WIKI_PROCESS_CHANGE_APPROVAL_GENERATOR,
  WIKI_PERSON_ESTIMATE_GENERATOR,
  WIKI_RETROSPECTIVE_GENERATOR,
])
