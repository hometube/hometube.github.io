import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  PanResponder,
  Animated,
  Easing,
} from "react-native";
import { router } from "expo-router";
import { usePlaybackState, useProgress, State } from "react-native-track-player";
import { Ionicons } from "@expo/vector-icons";
import { useMusicStore, cleanTitle } from "@/stores/musicStore";
import { useLibraryStore } from "@/stores/libraryStore";

export default function MiniPlayer() {
  const playbackState = usePlaybackState();
  const progress = useProgress(1000);
  const queue = useMusicStore((s) => s.queue);
  const currentIndex = useMusicStore((s) => s.currentIndex);
  const playlistId = useMusicStore((s) => s.playlistId);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const togglePlayPause = useMusicStore((s) => s.togglePlayPause);
  const next = useMusicStore((s) => s.next);
  const previous = useMusicStore((s) => s.previous);
  const seekTo = useMusicStore((s) => s.seekTo);
  const playlists = useLibraryStore((s) => s.playlists);

  const [dragValue, setDragValue] = useState<number | null>(null);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const widthRef = useRef(0);
  const dragValueRef = useRef<number | null>(null);
  const durationRef = useRef(0);
  const thumbAnim = useRef(new Animated.Value(0)).current;
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seekToRef = useRef(seekTo);

  const showThumb = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    thumbAnim.setValue(1);
  };

  const scheduleThumbHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      Animated.timing(thumbAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    }, 1000);
  };

  const seekPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        showThumb();
        const w = widthRef.current;
        const d = durationRef.current;
        if (w <= 0 || d <= 0) return;
        const x = Math.max(0, Math.min(e.nativeEvent.locationX, w));
        const v = (x / w) * d;
        dragValueRef.current = v;
        setDragValue(v);
      },
      onPanResponderMove: (e) => {
        const w = widthRef.current;
        const d = durationRef.current;
        if (w <= 0 || d <= 0) return;
        const x = Math.max(0, Math.min(e.nativeEvent.locationX, w));
        const v = (x / w) * d;
        dragValueRef.current = v;
        setDragValue(v);
      },
      onPanResponderRelease: () => {
        const v = dragValueRef.current;
        dragValueRef.current = null;
        setDragValue(null);
        if (v != null) {
          setPendingSeek(v);
          seekToRef.current(v);
        }
        scheduleThumbHide();
      },
      onPanResponderTerminate: () => {
        dragValueRef.current = null;
        setDragValue(null);
        scheduleThumbHide();
      },
    })
  ).current;

  const currentSong = currentIndex >= 0 ? queue[currentIndex] : null;
  const duration = progress.duration || 0;
  const position = progress.position || 0;

  useEffect(() => {
    if (pendingSeek == null) return;
    if (position > 0 && Math.abs(position - pendingSeek) < 0.75) {
      setPendingSeek(null);
    }
  }, [position, pendingSeek]);

  if (!currentSong) return null;

  const buffering =
    playbackState.state === State.Buffering ||
    playbackState.state === State.Loading;

  const live = dragValue ?? pendingSeek ?? position;
  const pct = duration > 0 ? Math.min(Math.max(live / duration, 0), 1) : 0;

  const fmtTime = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  durationRef.current = duration;
  seekToRef.current = seekTo;

  const playlistName =
    playlistId === "-1"
      ? "All Songs"
      : playlistId === "-2"
      ? "My Songs"
      : playlists.find((p) => String(p.id) === playlistId)?.name;

  const goToCurrentPlaylist = () => {
    if (!playlistId) return;
    const nameQuery = playlistName ? `?name=${encodeURIComponent(playlistName)}` : "";
    router.navigate(`/(tabs)/music/playlist/${playlistId}${nameQuery}` as any);
  };

  return (
    <View style={styles.wrapper} pointerEvents="auto">
      <View>
        <TouchableOpacity
          style={styles.container}
          activeOpacity={0.9}
          onPress={goToCurrentPlaylist}
        >
          <Text style={styles.marquee} numberOfLines={1}>
            {cleanTitle(currentSong.title)}
            {currentSong.artist ? `  •  ${currentSong.artist}` : ""}
          </Text>

          <View
            style={styles.seekWrap}
            onLayout={(e) => {
              widthRef.current = e.nativeEvent.layout.width;
            }}
            {...seekPanResponder.panHandlers}
          >
            <View style={styles.progressTrack} />
            <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.thumb,
                {
                  left: `${pct * 100}%`,
                  opacity: thumbAnim,
                  transform: [{ scale: thumbAnim }],
                },
              ]}
            />
          </View>

          <View style={styles.row}>
            <Text style={styles.time}>{fmtTime(live)}</Text>
            <View style={styles.controls}>
              <TouchableOpacity
                style={styles.control}
                onPress={(e) => {
                  e.stopPropagation();
                  previous();
                }}
              >
                <Ionicons name="play-skip-back" size={28} color="#fff" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.mainBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  togglePlayPause();
                }}
              >
                {buffering ? (
                  <ActivityIndicator size="small" color="#16213e" />
                ) : (
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={30}
                    color="#16213e"
                    style={!isPlaying ? styles.playIconNudge : undefined}
                  />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.control}
                onPress={(e) => {
                  e.stopPropagation();
                  next();
                }}
              >
                <Ionicons name="play-skip-forward" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.time}>{fmtTime(duration)}</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 90,
    elevation: 8,
  },
  container: {
    backgroundColor: "#16213e",
    borderTopWidth: 1,
    borderTopColor: "#0f3460",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 30,
  },
  seekWrap: {
    width: "100%",
    height: 34,
    zIndex: 2,
  },
  progressTrack: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "#333",
    borderRadius: 2,
  },
  progressFill: {
    position: "absolute",
    top: 8,
    left: 0,
    height: 4,
    backgroundColor: "#e94560",
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    top: 1,
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: "#e94560",
  },
  marquee: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 26,
  },
  time: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    width: 48,
    textAlign: "center",
  },
  control: {
    padding: 8,
  },
  playIconNudge: {
    transform: [{ translateX: 2 }],
  },
  mainBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
});