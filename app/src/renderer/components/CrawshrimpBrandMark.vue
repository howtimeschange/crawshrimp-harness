<template>
  <img class="crawshrimp-brand-mark" :src="avatarUrl" :width="size" :height="size"
    :style="{ width: `${size}px`, height: `${size}px` }" alt="" aria-hidden="true" draggable="false" decoding="async" />
</template>

<script setup>
import avatarUrl from '../../../assets/branding/crawshrimp-avatar-C1.png'
defineProps({ size: { type: Number, default: 24 } })
</script>

<style scoped>
.crawshrimp-brand-mark { display: inline-block; flex: none; object-fit: contain; vertical-align: middle; border-radius: 0; }
</style>
