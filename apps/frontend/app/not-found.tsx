import { EditionAwareNotFound } from '@/components/edition/EditionAwareNotFound'

/** 根 404：处理全站未匹配的路由与 `notFound()`，企业路由显示企业版说明。 */
export default function NotFound() {
  return <EditionAwareNotFound />
}
