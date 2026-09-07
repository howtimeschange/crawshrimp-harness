export const DOCKED_BROWSER_DIVIDER_WIDTH = 12
export const MIN_DOCKED_BROWSER_WIDTH = 420
export const MIN_DOCKED_CONVERSATION_WIDTH = 520
export const COMPACT_DOCKED_CONVERSATION_WIDTH = 280
export const DEFAULT_DOCKED_BROWSER_RATIO = 0.48

function finiteNonNegative(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export function dockedBrowserWidthBounds(containerWidth) {
  const width = finiteNonNegative(containerWidth)
  const divider = Math.min(DOCKED_BROWSER_DIVIDER_WIDTH, width)
  const conversationMinimum = Math.min(
    MIN_DOCKED_CONVERSATION_WIDTH,
    Math.max(COMPACT_DOCKED_CONVERSATION_WIDTH, Math.round(width * 0.34)),
  )
  const max = Math.max(0, width - divider - conversationMinimum)
  return {
    min: Math.min(MIN_DOCKED_BROWSER_WIDTH, max),
    max,
  }
}

export function clampDockedBrowserWidth(width, containerWidth) {
  const bounds = dockedBrowserWidthBounds(containerWidth)
  const candidate = finiteNonNegative(width)
  return Math.min(Math.max(candidate, bounds.min), bounds.max)
}

export function defaultDockedBrowserWidth(containerWidth) {
  return clampDockedBrowserWidth(Math.round(finiteNonNegative(containerWidth) * DEFAULT_DOCKED_BROWSER_RATIO), containerWidth)
}
