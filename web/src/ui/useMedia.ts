import { useEffect, useState } from 'react'

/** From this width the 3D views dock their panels (check results left, element details right); below, they're sheets. */
export const WIDE = '(min-width: 900px)'

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const change = () => setOn(m.matches)
    change()
    m.addEventListener('change', change)
    return () => m.removeEventListener('change', change)
  }, [query])
  return on
}
