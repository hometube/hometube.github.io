<script setup>
import { computed } from "vue";
import { faceGradient, initials } from "../store";

const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 40 },
});

const gradient = computed(() => {
  const [a, b] = faceGradient(props.name);
  return `linear-gradient(135deg, ${a}, ${b})`;
});
</script>

<template>
  <span
    class="face"
    :style="{
      background: gradient,
      width: size + 'px',
      height: size + 'px',
      fontSize: Math.round(size * 0.42) + 'px',
    }"
    :title="name"
    >{{ initials(name) }}</span
  >
</template>

<style scoped>
.face {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  font-weight: 650;
  letter-spacing: 0.01em;
  user-select: none;
  flex: none;
}
</style>
