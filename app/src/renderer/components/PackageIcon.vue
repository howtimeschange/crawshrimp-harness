<template><span class="adapter-icon"><img v-if="valid && !failed" :src="src" alt="" @error="failed=true"/><span v-else aria-hidden="true">🦐</span></span></template>
<script setup>
import {computed,ref,watch} from 'vue'
const props=defineProps({src:String}),failed=ref(false)
const valid=computed(()=>typeof props.src==='string' && props.src.length<=100000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(props.src))
watch(()=>props.src,()=>{failed.value=false})
</script>
<style scoped>.adapter-icon{display:inline-flex;width:32px;height:32px;flex:none;align-items:center;justify-content:center;font-size:27px}.adapter-icon img{width:100%;height:100%;object-fit:contain;border-radius:7px}</style>
