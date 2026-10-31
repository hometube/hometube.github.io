<script setup>
import { computed } from "vue";
import {
  currentTrack,
  cycleRepeat,
  fmtTime,
  next,
  player,
  prev,
  seek,
  setVolume,
  toggle,
  toggleShuffle,
} from "../player";
import { state } from "../store";

const track = computed(() => currentTrack());

function onSeek(e) {
  seek(Number(e.target.value));
}
</script>

<template>
  <footer class="bar">
    <div class="meta">
      <img v-if="track?.album_art" :src="track.album_art" class="art" alt="" />
      <span v-else class="art ph"
        ><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"
          ><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg
      ></span>
      <div class="text">
        <span class="title">{{ track?.title || "Nothing playing" }}</span>
        <span class="artist">{{ track?.artist || "" }}</span>
      </div>
    </div>

    <div class="center">
      <div class="buttons">
        <button
          class="icon-btn"
          :class="{ on: player.shuffle }"
          title="Shuffle"
          @click="toggleShuffle"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"
            ><path
              d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 8.46 20 10.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"
            /></svg>
        </button>
        <button class="icon-btn" title="Previous" @click="prev">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"
            ><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
        </button>
        <button class="play" :title="player.playing ? 'Pause' : 'Play'" @click="toggle">
          <span v-if="player.loading" class="spinner" />
          <svg v-else-if="player.playing" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"
            ><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>
          <svg v-else viewBox="0 0 24 24" width="20" height="20" fill="currentColor"
            ><path d="M8 5v14l11-7z" /></svg>
        </button>
        <button class="icon-btn" title="Next" @click="next()">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"
            ><path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z" /></svg>
        </button>
        <button
          class="icon-btn"
          :class="{ on: player.repeat !== 'off' }"
          :title="`Repeat: ${player.repeat}`"
          @click="cycleRepeat"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"
            ><path
              d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
            /></svg>
          <span v-if="player.repeat === 'one'" class="one">1</span>
        </button>
      </div>
      <div class="seek">
        <span class="time">{{ fmtTime(player.currentTime) }}</span>
        <input
          type="range"
          min="0"
          :max="player.duration || 0"
          step="0.5"
          :value="player.currentTime"
          :disabled="!track || !player.duration"
          @input="onSeek"
        />
        <span class="time">{{ fmtTime(player.duration) }}</span>
      </div>
    </div>

    <div class="right">
      <button
        class="queue-btn"
        :class="{ on: state.queueOpen }"
        title="Show the play queue"
        @click="state.queueOpen = !state.queueOpen"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"
          ><path
            d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zm12-6v6l4.5-3L15 10z"
          /></svg>
        <span>Queue</span>
        <span class="count">{{ player.order.length }}</span>
      </button>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--muted)" class="vol-icon"
        ><path d="M3 9v6h4l5 5V4L7 9H3z" /></svg
      >
      <input
        class="vol"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="player.volume"
        title="Volume"
        @input="setVolume(Number($event.target.value))"
      />
    </div>
  </footer>
</template>

<style scoped>
.bar {
  position: relative;
  border-top: 1px solid var(--border);
  background: var(--panel);
  display: grid;
  grid-template-columns: minmax(200px, 1fr) minmax(320px, 2fr) minmax(160px, 1fr);
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
}
.meta { display: flex; align-items: center; gap: 12px; min-width: 0; }
.art {
  width: 46px; height: 46px; border-radius: 8px; object-fit: cover; flex: none;
  display: block;
}
.art.ph {
  display: inline-flex; align-items: center; justify-content: center;
  background-image: var(--grad); color: rgba(255, 255, 255, 0.92);
}
.text { display: flex; flex-direction: column; min-width: 0; }
.title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artist { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.center { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.buttons { display: flex; align-items: center; gap: 10px; }
button.icon-btn {
  background: none; padding: 6px; color: var(--muted); position: relative;
  border-radius: 6px;
}
button.icon-btn:hover { color: var(--text); background: none; filter: none; }
button.icon-btn.on { color: var(--accent); }
.one {
  position: absolute; top: 2px; right: 1px; font-size: 9px; font-weight: 700;
}
.play {
  width: 40px; height: 40px; border-radius: 50%; display: inline-flex;
  align-items: center; justify-content: center; padding: 0;
}
.spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.seek { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 460px; }
.time { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; width: 36px; text-align: center; }
input[type="range"] {
  flex: 1; accent-color: var(--accent); height: 4px; cursor: pointer;
}
.right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.vol { width: 84px; flex: none; }
button.queue-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px;
  background: var(--inset); border: 1px solid var(--border); border-radius: 999px;
  color: var(--muted); font-size: 12px; font-weight: 550;
}
button.queue-btn:hover { color: var(--text); background: var(--inset); filter: none; }
button.queue-btn.on { color: var(--accent); border-color: var(--accent); }
.count {
  background: var(--panel); border-radius: 999px; padding: 0 7px;
  font-size: 11px; font-variant-numeric: tabular-nums;
}
button.queue-btn.on .count { background: rgba(224, 85, 155, 0.18); }
</style>
