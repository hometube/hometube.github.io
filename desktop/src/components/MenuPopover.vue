<script setup>
// Three-dot "more" trigger with a popover menu. The parent fills the
// default slot with option buttons (styled via :slotted below); clicking
// any option closes the menu, as does an outside click, Escape, or scroll
// (the menu would otherwise detach from its trigger inside the row list).
//
// The menu renders position:fixed, computed from the trigger's viewport
// rect: views clip their content (main and .rows-scroll use overflow), so
// an absolute popover near a clip edge gets sliced and looks buried under
// the sidebar. Right edge aligns with the trigger by default and flips to
// left-edge alignment when that would clip the window edge. We close on
// scroll, so the fixed position never drifts.
import { nextTick, onMounted, onUnmounted, ref } from "vue";

const root = ref(null);
const menuEl = ref(null);
const openMenu = ref(false);
const pos = ref({});

function close() {
  openMenu.value = false;
}

async function toggle() {
  if (openMenu.value) {
    close();
    return;
  }
  const rect = root.value.getBoundingClientRect();
  const gap = 6;
  const up = window.innerHeight - rect.bottom < 260;
  pos.value = {
    right: `${window.innerWidth - rect.right}px`,
    ...(up
      ? { bottom: `${window.innerHeight - rect.top + gap}px` }
      : { top: `${rect.bottom + gap}px` }),
  };
  openMenu.value = true;
  await nextTick();
  const w = menuEl.value?.offsetWidth || 0;
  if (rect.right - w < 12) {
    // Not enough room to open leftward inside the window: align the menu's
    // left edge with the trigger's instead, clamped to the viewport.
    pos.value = {
      ...pos.value,
      right: "auto",
      left: `${Math.max(12, Math.min(rect.left, window.innerWidth - w - 12))}px`,
    };
  }
}

function onDocClick(e) {
  if (openMenu.value && root.value && !root.value.contains(e.target)) close();
}
function onKey(e) {
  if (e.key === "Escape") close();
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", close, true);
});
onUnmounted(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", close, true);
});
</script>

<template>
  <div ref="root" class="mp" @click.stop>
    <button class="mp-btn" title="More" @click.stop="toggle">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </svg>
    </button>
    <div v-if="openMenu" ref="menuEl" class="mp-menu" :style="pos" @click="close">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mp { position: relative; display: inline-flex; }
.mp-btn {
  width: 30px; height: 30px; background: none; border: 1px solid var(--border);
  border-radius: 50%; color: var(--muted); flex: none; display: inline-flex;
  align-items: center; justify-content: center; padding: 0;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.mp-btn:hover { background: none; filter: none; border-color: var(--accent); color: var(--accent); }
.mp-menu {
  position: fixed; z-index: 50;
  min-width: 216px; max-width: min(320px, calc(100vw - 24px));
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; padding: 5px; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
  display: flex; flex-direction: column; gap: 1px;
}
/* Option buttons come from the parent slot; the global gradient <button>
   base must be flattened down to quiet list rows. */
.mp-menu :slotted(button) {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  background: none; background-image: none; border: 0; border-radius: 7px;
  padding: 8px 10px; font-size: 13.5px; font-weight: 400; color: var(--text);
}
.mp-menu :slotted(button:hover:not(:disabled)) { background: var(--inset); filter: none; }
.mp-menu :slotted(button.danger) { color: #ff7b72; }
</style>
