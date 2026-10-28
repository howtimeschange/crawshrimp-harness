<template>
  <img class="crawshrimp-membership-mark" :src="badgeUrl" :data-membership-tier="tier"
    :width="size" :height="size" :style="{ width: `${size}px`, height: `${size}px` }"
    alt="" aria-hidden="true" draggable="false" decoding="async" />
</template>

<script setup>
import { computed } from 'vue'
import brandUrl from '../../../assets/branding/crawshrimp-avatar-C1.png'
import plusUrl from '../../../assets/branding/crawshrimp-membership-plus.png'
import proUrl from '../../../assets/branding/crawshrimp-membership-pro.png'

const props = defineProps({ plan: { type: String, default: '' }, size: { type: Number, default: 24 } })
const badges = { plus: plusUrl, pro: proUrl }
const tier = computed(() => Object.hasOwn(badges, props.plan) ? props.plan : 'brand')
const badgeUrl = computed(() => badges[tier.value] || brandUrl)
</script>

<style scoped>
.crawshrimp-membership-mark { display: inline-block; flex: none; object-fit: contain; vertical-align: middle; border-radius: 0; }
</style>
