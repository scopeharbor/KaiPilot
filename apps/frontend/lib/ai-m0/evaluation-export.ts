import type { AiM0EvaluationRun } from '@aiproj/types'
import { summarizeEvaluationRun } from './evaluation-run'

export function exportRawJson(run: AiM0EvaluationRun): string {
  return JSON.stringify(run, null, 2)
}

export function exportSummaryJson(run: AiM0EvaluationRun): string {
  return JSON.stringify(
    {
      runId: run.id,
      mode: run.mode,
      inputSetHash: run.inputSetHash,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      summary: summarizeEvaluationRun(run),
    },
    null,
    2,
  )
}

const CSV_COLUMNS = [
  'stepId',
  'inputId',
  'repetition',
  'requestedStrategy',
  'effectiveStrategy',
  'bucket',
  'markerCoverage',
  'firstTokenMs',
  'totalMs',
  'retries',
  'provider',
  'model',
  'connectionId',
  'usingRealAdapter',
  'evidenceEligible',
  'triggeredErrors',
  'missingMarkerFields',
] as const

export function exportOutcomesCsv(run: AiM0EvaluationRun): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const outcome of run.outcomes) {
    lines.push(
      CSV_COLUMNS.map((column) => {
        const value = outcome[column]
        const text = Array.isArray(value) ? value.join('|') : String(value ?? '')
        return `"${text.replace(/"/g, '""')}"`
      }).join(','),
    )
  }
  return `\uFEFF${lines.join('\r\n')}`
}
