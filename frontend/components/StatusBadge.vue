<script setup>
// Shows a status as text AND color, so it is readable without relying on color alone.
defineProps({ status: { type: String, default: null } });
</script>

<template>
  <span class="badge" :class="`badge-${status || 'none'}`">
    {{ status || 'never run' }}
  </span>
</template>
