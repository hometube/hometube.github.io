<script setup>
// Rename dialog (playlists). Enter saves, Esc/scrim cancels; saving an
// unchanged or blank name just closes.
import { onMounted, ref } from "vue";

const props = defineProps({ name: { type: String, required: true } });
const emit = defineEmits(["save", "close"]);
const value = ref(props.name);

function save() {
  const next = value.value.trim();
  if (next && next !== props.name) emit("save", next);
  else emit("close");
}

onMounted(() => {
  const el = document.getElementById("rename-input");
  el?.focus();
  el?.select();
});
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="modal">
      <h2>Rename playlist</h2>
      <input id="rename-input" v-model="value" maxlength="200" @keydown.enter="save" />
      <div class="actions">
        <button :disabled="!value.trim()" @click="save">Save</button>
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
input {
  width: 100%; margin-top: 12px; background: var(--inset);
  border: 1px solid var(--border); border-radius: 8px; color: var(--text);
  padding: 9px 12px; font-size: 14px; outline: none;
}
input:focus { border-color: var(--accent); }
.actions { display: flex; gap: 10px; margin-top: 16px; }
</style>
