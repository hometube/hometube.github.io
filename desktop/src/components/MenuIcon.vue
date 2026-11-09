<script setup>
// Tiny icon helper for menu rows: brand-neutral 24-grid paths, currentColor.
const ICONS = {
  play: "M8 5v14l11-7z",
  playNext: "M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13.59-.41L19.17 15l-2.58 2.59L18 19l4-4-4-4-1.41 1.41 2.58 2.59z",
  add: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z",
  shuffle:
    "M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 8.46 20 10.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
  download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  pencil:
    "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
};
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 14 },
});
</script>

<template>
  <svg :viewBox="'0 0 24 24'" :width="size" :height="size" fill="currentColor" style="flex: none">
    <path :d="ICONS[name]" />
  </svg>
</template>
