<template>
  <span
    class="update-progress-ring"
    :class="{ compact }"
    role="progressbar"
    :aria-label="ariaLabel"
    :aria-valuenow="displayPercent"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <svg viewBox="0 0 36 36" aria-hidden="true">
      <circle class="ring-track" cx="18" cy="18" r="15.5" pathLength="100" />
      <circle
        class="ring-meter"
        cx="18"
        cy="18"
        r="15.5"
        pathLength="100"
        :stroke-dasharray="`${displayPercent} 100`"
      />
    </svg>
    <span class="ring-text">{{ displayPercent }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  percent: {
    type: Number,
    default: 0,
  },
  ariaLabel: {
    type: String,
    default: '下载进度',
  },
  compact: {
    type: Boolean,
    default: false,
  },
})

const displayPercent = computed(() => {
  const numeric = Number(props.percent)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, Math.round(numeric)))
})
</script>

<style scoped>
.update-progress-ring {
  position: relative;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--orange-text);
  font-variant-numeric: tabular-nums;
}

.update-progress-ring.compact {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
}

svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

circle {
  fill: none;
  stroke-linecap: round;
  stroke-width: 3.4;
}

.ring-track {
  stroke: rgba(var(--orange-rgb), 0.18);
}

.ring-meter {
  stroke: var(--orange);
  transition: stroke-dasharray 0.18s ease;
}

.ring-text {
  position: relative;
  z-index: 1;
  max-width: 72%;
  overflow: hidden;
  color: var(--text);
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  text-align: center;
}

.compact .ring-text {
  font-size: 9px;
}
</style>
