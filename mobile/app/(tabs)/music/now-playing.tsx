import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import TrackPlayer, {
  usePlaybackState,
  useProgress,
  useActiveTrack,
  State,
} from "react-native-track-player";
import { useMusicStore } from "@/stores/musicStore";
import { Ionicons } from "@expo/vector-icons";

export default function NowPlaying() {
  const track = useActiveTrack();
  const playbackState = usePlaybackState();
  const progress = useProgress(1000);
  const { togglePlayPause, next, previous, toggleShuffle, toggleRepeat, shuffle, repeat } =
    useMusicStore();

  const isPlaying = playbackState.state === State.Playing;
  const duration = progress.duration || 0;
  const position = progress.position || 0;
  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleSeekBack = () => {
    const newPos = Math.max(0, position - 10);
    TrackPlayer.seekTo(newPos);
  };

  const handleSeekForward = () => {
    const newPos = Math.min(duration, position + 10);
    TrackPlayer.seekTo(newPos);
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
          {track?.title || "No track playing"}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track?.artist || "Unknown"}
        </Text>
      </View>

      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatTime(position)}</Text>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleSeekBack}>
          <Ionicons name="play-skip-back" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.mainBtn, !track && styles.disabled]}
          onPress={togglePlayPause}
          disabled={!track}
        >
          <Ionicons
            name={isPlaying ? "pause" : "play"}
            size={32}
            color="#fff"
          />
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={handleSeekForward}>
          <Ionicons name="play-skip-forward" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.secondaryControls}>
        <TouchableOpacity onPress={toggleShuffle} style={styles.toggleBtn}>
          <Ionicons
            name="shuffle"
            size={20}
            color={shuffle === "on" ? "#e94560" : "#666"}
          />
        </TouchableOpacity>

        <TouchableOpacity style={styles.toggleBtn} onPress={previous}>
          <Ionicons name="play-skip-back" size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.toggleBtn} onPress={next}>
          <Ionicons name="play-skip-forward" size={20} color="#fff" />
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
    marginBottom: 30,
  },
  progressBar: {
    height: 4,
    backgroundColor: "#333",
    borderRadius: 2,
    marginBottom: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#e94560",
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  time: {
    color: "#666",
    fontSize: 12,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 40,
    marginBottom: 40,
  },
  mainBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#e94560",
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryBtn: {
    padding: 12,
  },
  disabled: { opacity: 0.5 },
  secondaryControls: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    alignItems: "center",
  },
  toggleBtn: { padding: 12 },
});
