<template>
  <dialog ref="dialog" class="auth-dialog" aria-label="登录抓虾" @cancel.prevent="emit('close')" @click="onBackdrop">
    <button class="auth-close" type="button" aria-label="关闭登录" @click="emit('close')"><IconX :size="18" /></button>
    <AccountPanel auth @authenticated="emit('close')" />
  </dialog>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { IconX } from '@tabler/icons-vue'
import AccountPanel from './AccountPanel.vue'
const emit = defineEmits(['close'])
const dialog = ref(null)
function onBackdrop(event) {
  if (event.target !== dialog.value) return
  const rect = dialog.value.getBoundingClientRect()
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) emit('close')
}
onMounted(() => dialog.value.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>

<style scoped>
.auth-dialog { position:fixed; inset:0; margin:auto; width:400px; max-width:calc(100vw - 32px); max-height:calc(100vh - 64px); box-sizing:border-box; padding:0; overflow:auto; color:var(--text); background:var(--bg2); border:1px solid var(--border-strong); border-radius:20px; box-shadow:0 24px 90px rgb(0 0 0 / .35),inset 0 1px 0 rgb(255 255 255 / .04); }
.auth-dialog::backdrop { background:rgb(0 0 0 / .38); backdrop-filter:blur(6px); }
.auth-close { position:absolute; right:12px; top:12px; width:28px; height:28px; display:grid; place-items:center; border:0; border-radius:8px; background:transparent; color:var(--text3); cursor:pointer; }
.auth-close:hover { background:var(--bg3); color:var(--text); }
.auth-close:focus-visible { outline:2px solid var(--orange); outline-offset:2px; }
</style>
