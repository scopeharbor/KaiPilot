/**
 * 组织级被动雷达信号 API（v3-triz-copilot-followups · tasks 6.1）。
 *
 * 封装调用 `GET /api/v1/organizations/:organizationId/signals`。
 * 数据形状与项目级信号同源（`ProjectSignal` / `ProjectSignalListResponse`），
 * 共享 `apps/frontend/lib/api/project-signals.ts` 的契约定义。
 */

export {
  organizationSignalsApi,
  organizationSignalKeys,
  type ProjectSignal,
  type ProjectSignalListFilters,
  type ProjectSignalListResponse,
  type ProjectSignalListMeta,
} from './project-signals'
