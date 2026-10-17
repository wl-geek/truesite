import { describe, expect, it } from 'vitest'
import { firstFocus, tabTarget } from './modal'

describe('modal focus (audit C-11, C-28)', () => {
  const items = ['close', 'title', 'save']

  it('wraps Tab from the last control to the first, and Shift+Tab from the first to the last', () => {
    expect(tabTarget(items, 'save', false)).toBe('close')
    expect(tabTarget(items, 'close', true)).toBe('save')
  })

  it('leaves moves between the controls inside to the browser', () => {
    expect(tabTarget(items, 'close', false)).toBeNull()
    expect(tabTarget(items, 'title', false)).toBeNull()
    expect(tabTarget(items, 'title', true)).toBeNull()
    expect(tabTarget(items, 'save', true)).toBeNull()
  })

  it('brings focus back in when it is outside the dialog', () => {
    expect(tabTarget(items, null, false)).toBe('close')
    expect(tabTarget(items, 'page link', false)).toBe('close')
    expect(tabTarget(items, 'page link', true)).toBe('save')
  })

  it('wraps a single control onto itself, and leaves a dialog without controls alone', () => {
    expect(tabTarget(['close'], 'close', false)).toBe('close')
    expect(tabTarget(['close'], 'close', true)).toBe('close')
    expect(tabTarget([], null, false)).toBeNull()
  })

  it('opens on the first field, else on the first control', () => {
    const isField = (s: string) => s === 'title' || s === 'language'
    expect(firstFocus(items, isField)).toBe('title')
    expect(firstFocus(['close', 'language', 'title'], isField)).toBe('language')
    expect(firstFocus(['next', 'continue'], isField)).toBe('next')
    expect(firstFocus([], isField)).toBeNull()
  })
})
