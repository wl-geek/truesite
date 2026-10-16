import type { MouseEvent, ReactNode, Ref } from 'react'
import { navigate } from '../router'

type LinkProps = { to: string; children: ReactNode; className?: string; current?: boolean; ref?: Ref<HTMLAnchorElement> }

/** In-app link: plain <a href> (works without JS, opens in a new tab) plus client-side navigation. */
export function Link({ to, children, className, current, ref }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a ref={ref} href={to} className={className} aria-current={current ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  )
}
