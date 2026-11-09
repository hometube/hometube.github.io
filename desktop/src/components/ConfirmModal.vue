<script setup>
// Generic confirm dialog (delete flows). Enter confirms, Esc/scrim cancels.
defineProps({
  title: { type: String, required: true },
  message: { type: String, default: "" },
  confirmLabel: { type: String, default: "Confirm" },
  danger: { type: Boolean, default: false },
});
const emit = defineEmits(["confirm", "close"]);

function onKey(e) {
  if (e.key === "Enter") emit("confirm");
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')" @keydown="onKey">
    <div class="modal">
      <h2>{{ title }}</h2>
      <p v-if="message" class="hint">{{ message }}</p>
      <div class="actions">
        <button :class="{ danger }" @click="emit('confirm')">{{ confirmLabel }}</button>
        <button class="secondary" @click="emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center; z-index: 40;
}
.modal {
  width: min(400px, 92vw); background: var(--panel);
  border: 1px solid var(--border); border-radius: 14px; padding: 24px;
}
h2 { margin: 0 0 6px; font-size: 17px; color: var(--text); text-transform: none; letter-spacing: 0; }
.hint { line-height: 1.55; }
.actions { display: flex; gap: 10px; margin-top: 18px; }
button.danger { background-image: none; background: #a32c34; }
button.danger:hover { background: #c03943; filter: none; }
</style>
