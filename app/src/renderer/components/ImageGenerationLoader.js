import React from 'react'
import { createRoot } from 'react-dom/client'
import { ImageGeneration } from 'img-fx'
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const revealedResultKeys = new Set()

function imageSources(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : [value])
    .map(item => String(item || '').trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

class ImageGenerationErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.warn('[ai-image] img-fx unavailable; using static loading preview', error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function StaticPreview({ src }) {
  return src
    ? React.createElement('img', { className: 'aiw-image-generation-fallback', src, alt: '' })
    : React.createElement('div', { className: 'aiw-image-generation-fallback' })
}

function ImageGenerationReact({ images, mode = 'static', revealKey = '' }) {
  const sources = imageSources(images)
  const sourceSignature = sources.join('\n')
  const safeRevealKey = String(revealKey || '').trim()
  const effectMode = ['loading', 'reveal'].includes(mode) ? mode : 'static'
  const shouldReveal = Boolean(effectMode === 'reveal' && sources.length)
  const fallback = React.createElement(StaticPreview, { src: sources[0] || '' })
  const revealHandle = React.useRef(null)
  const regenerationStartedRef = React.useRef(false)
  const [showStaticPreview, setShowStaticPreview] = React.useState(effectMode === 'static')

  React.useEffect(() => {
    regenerationStartedRef.current = false
  }, [effectMode, sourceSignature])

  React.useEffect(() => {
    if (effectMode === 'static') {
      setShowStaticPreview(true)
      return undefined
    }
    if (effectMode === 'loading') {
      setShowStaticPreview(false)
      // A lightbox edit starts from a real, already-visible source image. Prime
      // img-fx with one manual reveal, then immediately regenerate it into an
      // indefinite mosaic. autoReveal would otherwise loop back to revealing
      // this old image while the new image is still being generated.
      if (!(effectMode === 'loading' && sources.length)) return undefined
      let cancelled = false
      const triggerTimer = window.setTimeout(() => {
        if (!cancelled) revealHandle.current?.triggerReveal({ hold: 'manual' })
      }, 90)
      return () => {
        cancelled = true
        window.clearTimeout(triggerTimer)
      }
    }

    const alreadyRevealed = Boolean(safeRevealKey && revealedResultKeys.has(safeRevealKey))
    if (!shouldReveal || alreadyRevealed) {
      setShowStaticPreview(true)
      return undefined
    }

    setShowStaticPreview(false)
    let cancelled = false
    const finish = () => {
      if (cancelled) return
      if (safeRevealKey) revealedResultKeys.add(safeRevealKey)
      setShowStaticPreview(true)
    }
    const triggerTimer = window.setTimeout(() => {
      if (!cancelled) revealHandle.current?.triggerReveal({ hold: 'manual' })
    }, 90)
    const fallbackTimer = window.setTimeout(finish, 10000)
    return () => {
      cancelled = true
      window.clearTimeout(triggerTimer)
      window.clearTimeout(fallbackTimer)
    }
  }, [effectMode, safeRevealKey, shouldReveal, sourceSignature])

  if (effectMode === 'static') return fallback
  if (!supportsWebGL()) return fallback
  if (showStaticPreview) return fallback

  return React.createElement(
    ImageGenerationErrorBoundary,
    { fallback },
    React.createElement(
      ImageGeneration,
      {
        ref: revealHandle,
        className: 'aiw-image-generation-effect',
        preset: 'pixels-organic',
        theme: 'dark',
        images: sources,
        autoReveal: false,
        revealDelayRange: [1.2, 2.4],
        revealHoldMs: 1100,
        revealFadeOutMs: 260,
        pixelScale: 1.2,
        strength: 1,
        cardBg: '#000000',
        onCycle: (event) => {
          if (
            effectMode === 'loading'
            && sources.length
            && event?.phase === 'visible'
            && !regenerationStartedRef.current
          ) {
            regenerationStartedRef.current = true
            revealHandle.current?.triggerRegenerate({ autoReveal: false })
            return
          }
          if (effectMode !== 'reveal' || event?.phase !== 'visible') return
          if (safeRevealKey) revealedResultKeys.add(safeRevealKey)
          setShowStaticPreview(true)
        },
      },
      React.createElement('div', { className: 'aiw-image-generation-surface' }),
    ),
  )
}

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
    let root = null

    const renderReact = () => {
      if (!host.value || !root) return
      root.render(React.createElement(ImageGenerationReact, {
        images: imageSources(props.images),
        mode: props.mode,
        revealKey: props.revealKey,
      }))
    }

    onMounted(() => {
      root = createRoot(host.value)
      renderReact()
    })

    onBeforeUnmount(() => {
      if (root) root.unmount()
      root = null
    })

    watch(() => [props.images, props.mode, props.revealKey], renderReact, { deep: true })

    return () => h('div', { ref: host, class: 'aiw-image-generation-host', 'aria-hidden': 'true' })
  },
})
