<template>
  <div class="voyage-loader" :class="{ compact }" role="status" :aria-label="label">
    <svg class="voyage-scene" viewBox="0 0 240 160" fill="none" aria-hidden="true">
      <ellipse cx="120" cy="115" rx="92" ry="30" fill="currentColor" opacity=".045" />
      <g class="voyage-wave back" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".22">
        <path d="M22 113q15-7 30 0t30 0t30 0t30 0t30 0t30 0" />
      </g>
      <g class="voyage-boat">
        <path d="M119 31v84M69 61h100" stroke="#796354" stroke-width="2.5" stroke-linecap="round" />
        <path d="M72 63q45 8 95 0l-6 43q-43-10-86 0 7-22-3-43z" fill="#c5563e" />
        <path d="M79 65q6 19 2 36M98 67l1 32M119 68v30M140 67l-3 33M160 65l-6 37" stroke="#f2a079" stroke-opacity=".45" />
        <path d="M118 43L52 115m69-70 67 66" stroke="#796354" stroke-width="1" opacity=".6" />
        <path d="M43 99q-7-10-10-2-2 18 17 27 55 14 121-1 23-6 29-27-10 14-22 15H57q-12-1-14-12z" fill="#67574c" />
        <path d="M52 119q64 12 123-2" stroke="#bc9a76" stroke-width="1.5" />
        <path d="M72 118l-8 13m31-11-8 13m32-12-8 13m33-14-8 13m30-16-8 13" stroke="#907660" stroke-width="2" stroke-linecap="round" />
      </g>
      <g class="voyage-wave front" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".4">
        <path d="M35 132q12-5 24 0t24 0m23 0q12-5 24 0t24 0m19 0q12-5 24 0" />
        <path d="M73 144q11-4 22 0m48-1q11-4 22 0" opacity=".45" />
      </g>
    </svg>
    <strong class="voyage-title">{{ label }}</strong>
    <div class="voyage-copy" aria-hidden="true">
      <div class="voyage-copy-track">
        <span v-for="(line, index) in [...lines, lines[0]]" :key="index">{{ line }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ mode: { type: String, default: 'startup' }, compact: Boolean })
const label = computed(() => props.mode === 'image' ? '抓虾绘图中…' : '抓虾准备出航…')
const lines = computed(() => props.mode === 'image'
  ? ['灵感随浪而来', '捞一点色彩，添一点想象', '好图值得等一小会儿']
  : ['扬起红帆，准备与你一起开工', '写文案、画图片，灵感正在靠岸', '带上好奇心，一起去抓虾'])
</script>

<style scoped>
.voyage-loader { display: flex; flex-direction: column; align-items: center; color: #648e9d; text-align: center; width: 100%; }
.voyage-scene { width: 240px; max-width: 100%; height: 160px; overflow: visible; }
.voyage-boat { transform-origin: 120px 116px; animation: voyage-sail 4.8s ease-in-out infinite; }
.voyage-wave { animation: voyage-drift 4.8s ease-in-out infinite; }
.voyage-wave.back { animation-direction: reverse; animation-duration: 6s; }
.voyage-title { color: var(--text, #444); font-size: 15px; font-weight: 600; margin-top: 14px; letter-spacing: .04em; }
.voyage-copy { height: 24px; overflow: hidden; margin-top: 8px; color: var(--text2, #7c8188); font-size: 12px; line-height: 24px; }
.voyage-copy-track { animation: voyage-copy 12s infinite; }
.voyage-copy span { display: block; height: 24px; white-space: nowrap; }
.compact .voyage-scene { width: 180px; height: 120px; }
.compact .voyage-title { font-size: 13px; margin-top: 6px; }
@keyframes voyage-sail { 0%, 100% { transform: translateY(1px) rotate(-2deg); } 50% { transform: translateY(-4px) rotate(2deg); } }
@keyframes voyage-drift { 0%, 100% { transform: translateX(-5px); } 50% { transform: translateX(5px); } }
@keyframes voyage-copy { 0%, 27% { transform: translateY(0); } 33%, 60% { transform: translateY(-24px); } 66%, 93% { transform: translateY(-48px); } 100% { transform: translateY(-72px); } }
@media (prefers-reduced-motion: reduce) { .voyage-boat, .voyage-wave, .voyage-copy-track { animation: none; } }
</style>
