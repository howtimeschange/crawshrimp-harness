import React from 'react'
import { createRoot } from 'react-dom/client'
import { ImageGenerationReact } from './imageGenerationReact.js'
import { defineComponent, h, onBeforeUnmount, onMounted, onActivated, onDeactivated, ref, watch } from 'vue'

export default defineComponent({
  name: 'ImageGenerationLoader',
  props: {
    images: { type: Array, default: () => [] },
    mode: {
      type: String,
      default: 'static',
      validator: (value) => ['static', 'loading', 'reveal'].includes(value),
    },
    revealKey: { type: String, default: '' },
  },
  setup(props) {
    const host = ref(null)
    let activated = true
    const syncVisibility = () => renderReact()
    let root = null

    const renderReact = () => {
      if (!host.value || !root) return
      root.render(React.createElement(ImageGenerationReact, {
        images: props.images,
        mode: activated && !document.hidden ? props.mode : 'static',
        revealKey: props.revealKey,
      }))
    }

    onActivated(() => { activated = true; renderReact() })
    onDeactivated(() => { activated = false; renderReact() })
    onMounted(() => {
      document.addEventListener('visibilitychange', syncVisibility)
      root = createRoot(host.value)
      renderReact()
    })

    onBeforeUnmount(() => {
      document.removeEventListener('visibilitychange', syncVisibility)
      if (root) root.unmount()
      root = null
    })

    watch(() => [props.images, props.mode, props.revealKey], renderReact, { deep: true })

    return () => h('div', { ref: host, class: 'aiw-image-generation-host', 'aria-hidden': 'true' })
  },
})
