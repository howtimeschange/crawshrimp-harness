import { nextTick, onBeforeUnmount, watch } from 'vue'

// Keep modal ownership in the outer Vue surface; the embedded conversation is untouched.
export function useNativeDialog(visible, dialogRef, fallbackSelector) {
  let trigger = null
  const stop = watch(visible, async (open, previous, onCleanup) => {
    let stale = false
    onCleanup(() => { stale = true })
    if (open) trigger = document.activeElement
    await nextTick()
    if (stale) return
    const dialog = dialogRef.value
    if (open && dialog && !dialog.open) {
      dialog.showModal()
      ;(dialog.querySelector('[autofocus]') || dialog.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || dialog.querySelector('button'))?.focus()
    } else if (!open) {
      dialog?.close()
      const parentDialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1)
      if (!parentDialog || parentDialog.contains(trigger)) {
        const target = trigger?.isConnected ? trigger : fallbackSelector ? document.querySelector(fallbackSelector) : null
        target?.focus({ preventScroll: true })
      }
      trigger = null
    }
  }, { immediate: true })
  onBeforeUnmount(() => { stop(); dialogRef.value?.close() })
}
