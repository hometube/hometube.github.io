<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { currentTrack, fmtLong, jumpInOrder, player, removeFromOrder } from "../player";
import { state } from "../store";

const listEl = ref(null);

const rows = computed(() =>
  player.order.map((qi, pos) => ({ track: player.queue[qi], pos })).filter((r) => r.track)
);
// Sections like Spotify: what's ahead, then dimmed history you can revisit.
const upNext = computed(() => rows.value.slice(player.orderPos + 1));
const previous = computed(() => rows.value.slice(0, Math.max(0, player.orderPos)).reverse());
const cur = computed(() => currentTrack());

function esc(e) {
  if (e.key === "Escape" && state.queueOpen) state.queueOpen = false;
}

// Keep the current row in sight as the queue advances on its own.
watch(
  () => player.orderPos,
  async () => {
    if (!state.queueOpen) return;
    await nextTick();
    listEl.value
      ?.querySelector(".row-item.current")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
);

onMounted(() => window.addEventListener("keydown", esc));
onUnmounted(() => window.removeEventListener("keydown", esc));
</script>

<template>
  <aside class="queue-panel">
    <div class="head">
      <h2>Queue</h2>
      <button class="x" title="Close" @click="state.queueOpen = false">×</button>
    </div>

    <div ref="listEl" class="list">
      <template v-if="cur">
        <h3>Now playing</h3>
        <div class="row-item current">
          <span class="thumb" :class="{ art: !!cur.album_art }">
            <img v-if="cur.album_art" :src="cur.album_art" alt="" />
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="rgba(255,255,255,.92)"
              ><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
          </span>
          <span class="col">
            <span class="title" :title="cur.title">{{ cur.title || "Untitled" }}</span>
            <span class="artist">{{ cur.artist || "—" }}</span>
          </span>
          <span v-if="player.loading" class="spinner" />
          <button class="remove" title="Skip this and remove from queue" @click="removeFromOrder(player.orderPos)">
            ×
          </button>
        </div>
      </template>

      <template v-if="upNext.length">
        <h3>Next up</h3>
        <div
          v-for="{ track: t, pos } in upNext"
          :key="pos"
          class="row-item"
          @click="jumpInOrder(pos)"
        >
          <span class="thumb" :class="{ art: !!t.album_art }">
            <img v-if="t.album_art" :src="t.album_art" loading="lazy" alt="" />
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="rgba(255,255,255,.92)"
              ><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
            <span class="go">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"
                ><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
          <span class="col">
            <span class="title" :title="t.title">{{ t.title || "Untitled" }}</span>
            <span class="artist">{{ t.artist || "—" }}</span>
          </span>
          <span class="dur">{{ fmtLong(t.duration) }}</span>
          <button class="remove" title="Remove from queue" @click.stop="removeFromOrder(pos)">
            ×
          </button>
        </div>
      </template>

      <p v-else class="hint empty">Nothing queued after this.</p>

      <template v-if="previous.length">
        <h3>Earlier</h3>
        <div
          v-for="{ track: t, pos } in previous"
          :key="'p' + pos"
          class="row-item past"
          @click="jumpInOrder(pos)"
        >
          <span class="thumb" :class="{ art: !!t.album_art }">
            <img v-if="t.album_art" :src="t.album_art" loading="lazy" alt="" />
            <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="rgba(255,255,255,.92)"
              ><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg>
          </span>
          <span class="col">
            <span class="title" :title="t.title">{{ t.title || "Untitled" }}</span>
            <span class="artist">{{ t.artist || "—" }}</span>
          </span>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.queue-panel {
  width: 330px; flex: none; border-left: 1px solid var(--border);
  background: var(--bg); display: flex; flex-direction: column; min-height: 0;
}
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 16px 10px;
}
.head h2 { margin: 0; }
.x {
  background: none; color: var(--muted); font-size: 20px; padding: 2px 8px;
  border-radius: 6px; line-height: 1;
}
.x:hover { color: var(--text); background: none; filter: none; }
.list { flex: 1; overflow-y: auto; padding: 0 8px 16px; }
h3 {
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--muted); margin: 14px 8px 6px;
}
.row-item {
  display: flex; align-items: center; gap: 10px; padding: 7px 8px;
  border-radius: 9px; cursor: pointer; font-size: 13px;
}
.row-item:hover { background: var(--panel); }
.row-item.current { background: var(--panel); color: var(--accent); cursor: default; }
.row-item.past { opacity: 0.55; }
.row-item.past:hover { opacity: 1; }
.thumb {
  position: relative; width: 38px; height: 38px; border-radius: 7px; flex: none;
  overflow: hidden; display: inline-flex; align-items: center; justify-content: center;
  background: var(--inset);
}
.thumb.art { background: #000; }
.thumb:not(.art) { background-image: var(--grad); }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb .go {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); opacity: 0;
}
.row-item:hover .thumb .go { opacity: 1; }
.col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.title { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artist { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dur { color: var(--muted); font-size: 11px; flex: none; font-variant-numeric: tabular-nums; }
.remove {
  background: none; color: var(--muted); font-size: 15px; padding: 2px 6px;
  border-radius: 6px; opacity: 0; flex: none; line-height: 1;
}
.row-item:hover .remove { opacity: 1; }
.remove:hover { color: #ff7b72; background: none; filter: none; }
.spinner {
  width: 13px; height: 13px; border-radius: 50%; flex: none;
  border: 2px solid rgba(255, 255, 255, 0.25); border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.empty { margin: 4px 8px 0; }
</style>
