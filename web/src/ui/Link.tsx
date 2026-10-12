import type { MouseEvent, ReactNode } from 'react'
import { navigate } from '../router'

type LinkProps = { to: string; children: ReactNode; className?: string; current?: boolean }

/** In-app link: plain <a href> (works without JS, opens in a new tab) plus client-side navigation. */
export function Link({ to, children, className, current }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} className={className} aria-current={current ? 'page' : undefined} onClick={onClick}>
      {children}
    </a>
  )
}
