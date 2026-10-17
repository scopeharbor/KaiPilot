/**
 * renderer-fixtures —— 确定性 UI Renderer 共享测试夹具（§1.4 P0）。
 *
 * 提供有效/无效/边界配置用于前后端测试一致性。
 */

// ─── 有效 Dashboard 配置 ──────────────────────────────
export const VALID_DASHBOARD_CONFIG = {
  id: 'dash-1',
  type: 'dashboard' as const,
  title: '项目仪表盘',
  icon: 'LayoutDashboard',
  config: {
    type: 'dashboard' as const,
    config: {
      widgets: [
        {
          id: 'w-1',
          type: 'completion_rate' as const,
          title: '完成率',
          icon: 'CheckCircle',
          width: 4,
          height: 2,
          dataQuery: {
            source: 'dashboard_metrics' as const,
            fields: ['completion_rate', 'total_tasks'],
          },
        },
        {
          id: 'w-2',
          type: 'overdue_tasks' as const,
          title: '逾期任务',
          icon: 'AlertTriangle',
          width: 4,
          height: 2,
          dataQuery: {
            source: 'task_summary' as const,
            filters: [{ field: 'status', operator: 'eq' as const, value: 'overdue' }],
            sort: [{ field: 'due_date', direction: 'asc' as const }],
            limit: 10,
          },
        },
      ],
    },
  },
}

// ─── 有效 List 配置 ────────────────────────────────────
export const VALID_LIST_CONFIG = {
  id: 'list-1',
  type: 'list' as const,
  title: '任务列表',
  icon: 'List',
  config: {
    type: 'list' as const,
    config: {
      columns: ['name', 'status', 'priority', 'assignee', 'due_date'],
      groupBy: 'status',
      showSearch: true,
      defaultSort: { field: 'priority', direction: 'desc' as const },
    },
  },
}

// ─── 有效 Gantt 配置 ──────────────────────────────────
export const VALID_GANTT_CONFIG = {
  id: 'gantt-1',
  type: 'gantt' as const,
  title: '甘特图',
  icon: 'GanttChart',
  config: {
    type: 'gantt' as const,
    config: {
      showDependencies: true,
      showCriticalPath: true,
      showProgress: true,
      timeScale: 'week' as const,
    },
  },
}

// ─── 有效 WBS 配置 ────────────────────────────────────
export const VALID_WBS_CONFIG = {
  id: 'wbs-1',
  type: 'wbs' as const,
  title: 'WBS',
  icon: 'Network',
  config: {
    type: 'wbs' as const,
    config: {
      showFields: ['name', 'status', 'assignee'],
      expandedLevel: 3,
      showCompletion: true,
    },
  },
}

// ─── 有效 Kanban 配置 ─────────────────────────────────
export const VALID_KANBAN_CONFIG = {
  id: 'kanban-1',
  type: 'kanban' as const,
  title: '看板',
  icon: 'Kanban',
  config: {
    type: 'kanban' as const,
    config: {
      columnField: 'status',
      showEmptyColumns: false,
      collapsedColumns: ['done'],
    },
  },
}

// ─── 有效 ProjectViewConfig ──────────────────────────
export const VALID_PROJECT_VIEW_CONFIG = {
  schemaVersion: 1,
  projectId: 1,
  defaultViewId: 'dash-1',
  views: [
    VALID_DASHBOARD_CONFIG,
    VALID_LIST_CONFIG,
    VALID_GANTT_CONFIG,
    VALID_WBS_CONFIG,
    VALID_KANBAN_CONFIG,
  ],
}

// ─── 无效：包含 JSX/代码片段 ─────────────────────────
export const UNSAFE_CODE_CONFIG = {
  id: 'unsafe-1',
  type: 'dashboard' as const,
  title: '危险视图',
  config: {
    type: 'dashboard' as const,
    config: {
      widgets: [
        {
          id: 'w-unsafe',
          type: 'custom' as const,
          title: '注入组件',
          jsx: '<div onClick="alert(1)">click</div>',
          script: 'fetch("/api/evil").then(r => r.text())',
        },
      ],
    },
  },
}

// ─── 无效：引用未注册组件 ────────────────────────────
export const UNSUPPORTED_COMPONENT_CONFIG = {
  id: 'bad-comp-1',
  type: 'unknown-view-type' as any,
  title: '未知组件',
  config: {
    type: 'custom' as const,
    config: {
      renderer: 'dynamic-react-renderer',
    },
  },
}

// ─── 权限受限 Dashboard widget 配置 ─────────────────
export const PERMISSION_REDACTED_WIDGET_CONFIG = {
  id: 'perm-1',
  type: 'dashboard' as const,
  title: '权限受限仪表盘',
  icon: 'LayoutDashboard',
  config: {
    type: 'dashboard' as const,
    config: {
      widgets: [
        {
          id: 'w-risk',
          type: 'risk_health' as const,
          title: '风险健康度',
          redactOnPermission: ['risk:view'],
          dataQuery: { source: 'risk_summary' as const },
        },
        {
          id: 'w-resource',
          type: 'resource_load' as const,
          title: '资源负载',
          redactOnPermission: ['resource:view'],
          dataQuery: { source: 'resource_summary' as const },
        },
      ],
    },
  },
}

// ─── 无效：数据查询包含 SQL ──────────────────────────
export const UNSAFE_QUERY_CONFIG = {
  id: 'bad-query-1',
  type: 'list' as const,
  title: 'SQL 注入视图',
  config: {
    type: 'list' as const,
    config: { showSearch: true },
  },
  dataQuery: {
    source: 'custom_sql' as any,
    sql: 'SELECT * FROM projects WHERE 1=1; DROP TABLE tasks;',
  },
}

// ─── 大小超限配置（用于测试）──────────────────────────
export function generateOversizedConfig(widgetCount: number = 100) {
  return {
    schemaVersion: 1,
    projectId: 1,
    defaultViewId: 'dash-1',
    views: [
      {
        id: 'dash-1',
        type: 'dashboard' as const,
        title: '仪表盘',
        config: {
          type: 'dashboard' as const,
          config: {
            widgets: Array.from({ length: widgetCount }, (_, i) => ({
              id: `w-${i}`,
              type: 'completion_rate' as const,
              title: `Widget ${i}`,
            })),
          },
        },
      },
    ],
  }
}

// ─── 全部有效配置列表 ────────────────────────────────
export const ALL_VALID_CONFIGS = [
  VALID_DASHBOARD_CONFIG,
  VALID_LIST_CONFIG,
  VALID_GANTT_CONFIG,
  VALID_WBS_CONFIG,
  VALID_KANBAN_CONFIG,
]

// ─── 全部不安全/无效配置列表 ─────────────────────────
export const ALL_UNSAFE_CONFIGS = [
  UNSAFE_CODE_CONFIG,
  UNSUPPORTED_COMPONENT_CONFIG,
  UNSAFE_QUERY_CONFIG,
]
