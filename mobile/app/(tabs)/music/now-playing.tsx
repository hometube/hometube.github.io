import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from "react-native";
import { router } from "expo-router";
import TrackPlayer, {
  usePlaybackState,
  useProgress,
  useActiveTrack,
  State,
} from "react-native-track-player";
import Slider from "@react-native-community/slider";
import { useMusicStore, cleanTitle } from "@/stores/musicStore";
import { Ionicons } from "@expo/vector-icons";

export default function NowPlaying() {
  const track = useActiveTrack();
  const playbackState = usePlaybackState();
  const progress = useProgress(1000);
  const {
    togglePlayPause,
    next,
    previous,
    toggleShuffle,
    toggleRepeat,
    seekTo,
    shuffle,
    repeat,
    playlistId,
    playlists,
  } = useMusicStore();
  const [scrubValue, setScrubValue] = useState<number | null>(null);

  const isPlaying = playbackState.state === State.Playing;
  const duration = progress.duration || 0;
  const position = scrubValue ?? (progress.position || 0);
  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const playlistName =
    playlistId === "-1"
      ? "All Songs"
      : playlistId === "-2"
      ? "My Songs"
      : playlists.find((p) => String(p.id) === playlistId)?.name;

  const goToCurrentPlaylist = () => {
    if (!playlistId) return;
    const nameQuery = playlistName ? `?name=${encodeURIComponent(playlistName)}` : "";
    router.push(`/(tabs)/music/playlist/${playlistId}${nameQuery}` as any);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="chevron-down" size={28} color="#fff" />
      </TouchableOpacity>

      <View style={styles.artworkContainer}>
        {track?.artwork ? (
          <Image source={{ uri: track.artwork }} style={styles.artwork} />
        ) : (
          <View style={styles.artworkPlaceholder}>
            <Ionicons name="musical-notes" size={64} color="#444" />
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {cleanTitle(track?.title) || "No track playing"}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track?.artist || "Unknown"}
        </Text>
      </View>

      <View style={styles.progressContainer}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={Math.max(duration, 1)}
          value={Math.min(position, Math.max(duration, 1))}
          onValueChange={(v) => setScrubValue(v)}
          onSlidingComplete={(v) => {
            seekTo(v);
            setScrubValue(null);
          }}
          minimumTrackTintColor="#e94560"
          maximumTrackTintColor="#333"
          thumbTintColor="#e94560"
          disabled={!track || duration <= 0}
        />
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(position)}</Text>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
      </View>

      {playlistId ? (
        <TouchableOpacity style={styles.playlistBtn} onPress={goToCurrentPlaylist}>
          <Ionicons name="eye" size={16} color="#4ecca3" />
          <Text style={styles.playlistBtnText}>
            {playlistName ? `View playlist: ${playlistName}` : "View playlist"}
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.controls}>
        <TouchableOpacity onPress={previous} style={styles.controlBtn}>
          <Ionicons name="play-skip-back" size={26} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.mainBtn, !track && styles.disabled]}
          onPress={togglePlayPause}
          disabled={!track}
        >
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={34}
            color="#fff"
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={next} style={styles.controlBtn}>
          <Ionicons name="play-skip-forward" size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.toggles}>
        <TouchableOpacity onPress={toggleShuffle} style={styles.toggleBtn}>
          <Ionicons
            name="shuffle"
            size={20}
            color={shuffle === "on" ? "#e94560" : "#666"}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={toggleRepeat} style={styles.toggleBtn}>
          <Ionicons
            name="repeat"
            size={20}
            color={repeat ? "#e94560" : "#666"}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  backBtn: {
    marginBottom: 20,
    alignSelf: "flex-start",
    padding: 4,
  },
  artworkContainer: {
    alignItems: "center",
    marginBottom: 40,
  },
  artwork: {
    width: 280,
    height: 280,
    borderRadius: 16,
  },
  artworkPlaceholder: {
    width: 280,
    height: 280,
    borderRadius: 16,
    backgroundColor: "#16213e",
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    alignItems: "center",
    marginBottom: 30,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 6,
  },
  artist: {
    color: "#888",
    fontSize: 16,
  },
  progressContainer: {
    marginBottom: 20,
  },
  slider: {
    width: "100%",
    height: 32,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  time: {
    color: "#666",
    fontSize: 12,
  },
  playlistBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 6,
    marginBottom: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(78,204,163,0.12)",
  },
  playlistBtnText: {
    color: "#4ecca3",
    fontSize: 13,
    fontWeight: "500",
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 32,
  },
  mainBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#e94560",
    justifyContent: "center",
    alignItems: "center",
  },
  controlBtn: {
    padding: 12,
  },
  toggles: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    marginTop: 8,
  },
  disabled: { opacity: 0.5 },
  toggleBtn: { padding: 8 },
});