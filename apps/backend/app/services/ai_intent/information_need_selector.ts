import type {
  ClarificationLedger,
  InformationNeed,
  InformationNeedPriority,
  KnownUnknown,
} from '@aiproj/types'
import {
  assessNeedAgainstLedger,
  textSimilarity,
  type NeedCoverageVerdict,
} from './clarification_coverage.js'

const PRIORITY_WEIGHT: Record<InformationNeed['priority'], number> = {
  blocking: 100,
  high: 70,
  useful: 35,
  optional: 10,
}
const EFFORT_COST: Record<InformationNeed['userEffort'], number> = {
  low: 0,
  medium: 8,
  high: 18,
}
const SENSITIVITY_COST: Record<InformationNeed['sensitivity'], number> = {
  none: 0,
  low: 6,
  high: 24,
}

export interface RankedInformationNeed {
  need: InformationNeed
  score: number
  duplicateSimilarity: number
  /**
   * 排序与「还差多少关键信息」都用这个优先级，而不是模型原始的 priority。
   * 主题已经答过、只是问得更细的需求会被降到 useful：它可以继续问，
   * 但不再有资格挡住草案生成入口。
   */
  effectivePriority: InformationNeedPriority
  coverageVerdict: NeedCoverageVerdict
}

export default class InformationNeedSelector {
  rank(input: {
    needs: InformationNeed[]
    ledger: ClarificationLedger
    knownUnknowns: KnownUnknown[]
  }): RankedInformationNeed[] {
    const closed = new Set(
      input.ledger.entries
        .filter((entry) => entry.status === 'answered' || entry.status === 'known_unknown')
        .map((entry) => entry.needId),
    )
    input.knownUnknowns.forEach((item) => closed.add(item.needId))
    const history = input.ledger.entries.map((entry) => `${entry.topic} ${entry.questionSummary}`)
    return (
      input.needs
        .filter((need) => !closed.has(need.id))
        .map((need) => {
          const duplicateSimilarity = history.reduce(
            (max, text) =>
              Math.max(max, textSimilarity(`${need.topic} ${need.missingInformation}`, text)),
            0,
          )
          const assessment = assessNeedAgainstLedger(need, input.ledger)
          // 主题已覆盖、只是问得更细时降级为不阻断，免得模型靠不断细化把生成入口永久挡住。
          // blocking 不降级：它的含义是「不确认就排不出计划」，真正的重复提问已由 repeat 挡掉。
          const effectivePriority: InformationNeedPriority =
            assessment.verdict === 'finer' && need.priority === 'high' ? 'useful' : need.priority
          const downstreamUnlocks = input.needs.filter((candidate) =>
            candidate.dependsOn?.includes(need.id),
          ).length
          const score =
            PRIORITY_WEIGHT[effectivePriority] +
            need.decisionImpact.length * 9 +
            need.uncertainty * 20 +
            downstreamUnlocks * 8 -
            EFFORT_COST[need.userEffort] -
            SENSITIVITY_COST[need.sensitivity] -
            duplicateSimilarity * 60
          return {
            need,
            score,
            duplicateSimilarity,
            effectivePriority,
            coverageVerdict: assessment.verdict,
          }
        })
        // 同一件事问过就不再问。原实现的相似度在纯中文上恒为 0，这道闸门从未真正生效。
        .filter((entry) => entry.coverageVerdict !== 'repeat')
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.need.decisionImpact.length - left.need.decisionImpact.length ||
            left.need.id.localeCompare(right.need.id),
        )
    )
  }

  selectOne(input: {
    needs: InformationNeed[]
    ledger: ClarificationLedger
    knownUnknowns: KnownUnknown[]
  }): RankedInformationNeed | null {
    return this.rank(input)[0] ?? null
  }
}
