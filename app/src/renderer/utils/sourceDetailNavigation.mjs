// UI-only request/focus lifetime. Epoch still belongs to the panel's existing
// account/IPC boundary; these tickets only fence detail rendering and focus.
export function createSourceDetailNavigation({ context, nextTick, heading, fallback }) {
  let active = null, sequence = 0
  const sameContext = ticket => {
    const now = context(), before = ticket?.context
    return !!before && now.alive && ['epoch', 'ownerID', 'roomID', 'policyID'].every(key => now[key] === before[key])
  }
  const isCurrent = ticket => !!ticket && active === ticket && ticket.sequence === sequence && sameContext(ticket)
  const invalidate = () => { active = null; sequence++ }
  const focus = (element, block) => {
    if (!element?.isConnected || element.disabled) return false
    element.focus({ preventScroll: true })
    // Always immediate, including when an ancestor has scroll-behavior:smooth.
    // This also respects Reduce Motion without scheduling an animation.
    element.scrollIntoView({ behavior: 'instant', block, inline: 'nearest' })
    return true
  }
  return {
    begin(trigger) { return (active = { sequence: ++sequence, context: context(), trigger }) },
    isCurrent,
    invalidate,
    async reveal(ticket) {
      await nextTick()
      if (isCurrent(ticket)) focus(heading(), 'start')
    },
    async restore() {
      const ticket = active
      invalidate()
      const closingSequence = sequence
      await nextTick()
      if (sequence !== closingSequence || !sameContext(ticket)) return
      // A close while another read is pending may leave its trigger disabled.
      // Return to the history heading instead of focusing a disabled control.
      if (!focus(ticket.trigger, 'nearest')) focus(fallback(), 'nearest')
    },
  }
}
