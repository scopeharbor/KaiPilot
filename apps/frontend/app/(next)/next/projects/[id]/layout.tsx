import type { ReactNode } from 'react'
import { ProjectRouteScope } from './project-route-scope'

/** 项目内全部页面共享项目权限作用域（项目经理等项目角色的管理权限在此生效）。 */
export default function ProjectLayout({ children }: { children: ReactNode }) {
  return <ProjectRouteScope>{children}</ProjectRouteScope>
}
