import type { MouseEvent, ReactNode, Ref } from 'react'
import { navigate } from '../router'

type LinkProps = {
  to: string
  children: ReactNode
  className?: string
  current?: boolean
  ref?: Ref<HTMLAnchorElement>
  /** Name for an icon-only link, such as the camera view's Exit. */
  'aria-label'?: string
}

/** In-app link: plain <a href> (works without JS, opens in a new tab) plus client-side navigation. */
export function Link({ to, children, className, current, ref, 'aria-label': ariaLabel }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a ref={ref} href={to} className={className} aria-label={ariaLabel} aria-current={current ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  )
}
