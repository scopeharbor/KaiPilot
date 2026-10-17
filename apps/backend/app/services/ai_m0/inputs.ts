/**
 * ai-structured-output-poc / M0 —— 12 条评测输入集（4 类 × 3 条）。
 *
 * spec 硬约束「M0 覆盖软件/活动/研究/产品四类输入」+ apply 决策 N=12。
 * 每一条输入包含：
 *   - `id`：稳定字符串 ID（进报告 CSV 作主键）；
 *   - `category`：软件 / 活动 / 研究 / 产品；
 *   - `sentence`：一句话简体中文项目描述；
 *   - `expectedRequiredInferredFields`：AIMarker 100% 覆盖清单（judge.ts 消费）。
 *
 * 全部字面量、无随机源、无外部 fetch；数据集哈希由 `services/ai_m0/eval.ts` 计算，
 * 进 `AiM0EnvironmentMetadata.inputSetHash` 保证跨运行同源。
 */

import type { AiM0InputCase } from '@aiproj/types'

/**
 * 每个输入的必填推断字段清单：spec「必填推断字段清单」= 章程 6 字段 + 任务高风险 3 字段 + wbs 名称。
 * 每类项目具体侧重点略有差异（如 event 更看重 startDate，research 更看重 successCriteria）。
 */
const COMMON_REQUIRED = [
  'charter.title',
  'charter.vision',
  'charter.scope',
  'charter.successCriteria',
  'charter.startDate',
  'charter.endDate',
  'tasks[].durationDays',
  'tasks[].startDate',
  'tasks[].endDate',
  'wbs[].name',
]

export const AI_M0_INPUT_CASES: AiM0InputCase[] = [
  // ── software（3）──
  {
    id: 'sw-01',
    category: 'software',
    sentence: '搭建一个企业内部的 OA 审批系统，需要支持请假、报销、印章三类流程。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  {
    id: 'sw-02',
    category: 'software',
    sentence: '开发一个面向 SMB 的 SaaS 记账工具，V1 只做发票录入与月度报表。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  {
    id: 'sw-03',
    category: 'software',
    sentence: '重构现有电商后台的订单履约模块,把单体拆成 3 个微服务并保留旧数据兼容。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  // ── event（3）──
  {
    id: 'ev-01',
    category: 'event',
    sentence: '筹办公司年度技术峰会,预计线下 300 人、线上直播 5000 人,时间在 12 月中旬。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  {
    id: 'ev-02',
    category: 'event',
    sentence: '组织一场为期两周的高校编程马拉松,含赛前培训、初复决赛与颁奖典礼。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  {
    id: 'ev-03',
    category: 'event',
    sentence: '筹备一场 20 人的公司团建,含户外拓展、晚宴与次日复盘会。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  // ── research（3）──
  {
    id: 'rs-01',
    category: 'research',
    sentence: '完成一份关于国内低代码平台市场格局的调研报告,含 8 家厂商横向对比。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  {
    id: 'rs-02',
    category: 'research',
    sentence: '研究并撰写机器学习在建筑能耗预测中的应用综述,含 30+ 文献综述与实验对比。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  {
    id: 'rs-03',
    category: 'research',
    sentence: '开展一个 2 个月的用户调研项目,通过 50 场访谈了解中小微企业的项目管理痛点。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  // ── product（3）──
  {
    id: 'pd-01',
    category: 'product',
    sentence: '设计一款面向咖啡师的智能温控咖啡机,V1 完成工业设计、样机制作与首批 50 台试产。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  {
    id: 'pd-02',
    category: 'product',
    sentence: '推出一款面向宠物主人的智能喂食器,含硬件设计、App 联动与首批渠道上架。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
  {
    id: 'pd-03',
    category: 'product',
    sentence: '开发一款教育硬件学习灯,含护眼光源、儿童行为识别与家长端 App,目标暑期上市。',
    expectedRequiredInferredFields: COMMON_REQUIRED,
  },
]

/** 供 environment metadata 使用的稳定 hash（djb2）。 */
export function hashInputCases(cases: readonly AiM0InputCase[] = AI_M0_INPUT_CASES): string {
  const source = cases
    .map((c) => `${c.id}|${c.category}|${c.sentence}|${c.expectedRequiredInferredFields.join(',')}`)
    .join('||')
  let h = 5381
  for (let i = 0; i < source.length; i++) {
    h = ((h << 5) + h + source.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
