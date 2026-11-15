<script setup>
defineProps({ connected: Boolean });
</script>

<template>
  <span class="live" :class="{ 'live-off': !connected }">
    <span class="live-dot" />
    {{ connected ? 'Live' : 'Reconnecting...' }}
  </span>
</template>
