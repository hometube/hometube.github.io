import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  PanResponder,
  Animated,
  Easing,
} from "react-native";
import { usePlaybackState, useProgress, State } from "react-native-track-player";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMusicStore, cleanTitle } from "@/stores/musicStore";
import { EmptyState } from "@/components";

const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

export default function PodcastPlayingView() {
  const queue = useMusicStore((s) => s.queue);
  const currentIndex = useMusicStore((s) => s.currentIndex);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const rate = useMusicStore((s) => s.rate);
  const togglePlayPause = useMusicStore((s) => s.togglePlayPause);
  const next = useMusicStore((s) => s.next);
  const previous = useMusicStore((s) => s.previous);
  const seekTo = useMusicStore((s) => s.seekTo);
  const setRate = useMusicStore((s) => s.setRate);
  const error = useMusicStore((s) => s.error);
  const setPlaybackError = useMusicStore((s) => s.setPlaybackError);

  const playbackState = usePlaybackState();
  const progress = useProgress(1000);

  const [dragValue, setDragValue] = useState<number | null>(null);
  const widthRef = useRef(0);
  const dragValueRef = useRef<number | null>(null);
  const durationRef = useRef(0);
  const thumbAnim = useRef(new Animated.Value(0)).current;
  const pendingValue = useRef<number | null>(null);

  const currentSong = currentIndex >= 0 ? queue[currentIndex] : null;
  const nextSong = currentIndex >= 0 ? queue[currentIndex + 1] : null;

  const duration = progress.duration || 0;
  const position = progress.position || 0;

  const isPodcast = currentSong?.kind === "podcast";

  useEffect(() => {
    if (currentSong && !isPodcast) {
      router.navigate("/(tabs)/music/playing" as any);
    }
  }, [currentSong, isPodcast]);

  const showThumb = () => thumbAnim.setValue(1);

  const scheduleThumbHide = () => {
    Animated.timing(thumbAnim, {
      toValue: 0,
      duration: 300,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
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
          pendingValue.current = v;
          seekTo(v);
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

  useEffect(() => {
    if (pendingValue.current == null) return;
    if (position > 0 && Math.abs(position - pendingValue.current) < 0.75) {
      pendingValue.current = null;
    }
  }, [position]);

  if (!currentSong) {
    return (
      <View style={styles.container}>
        <EmptyState
          icon="radio-outline"
          title="Nothing playing"
          message="Play a podcast episode to get started."
        />
      </View>
    );
  }

  if (!isPodcast) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#9070e9" style={{ marginTop: 40 }} />
      </View>
    );
  }

  const buffering =
    playbackState.state === State.Buffering ||
    playbackState.state === State.Loading;

  const live = dragValue ?? position;
  const pct = duration > 0 ? Math.min(Math.max(live / duration, 0), 1) : 0;

  const fmtTime = (s: number) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  durationRef.current = duration;

  const handleRate = (value: number) => {
    setRate(value);
  };

  const dismissPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 60) router.back();
      },
    })
  ).current;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header} {...dismissPanResponder.panHandlers}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-down" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.heading}>Podcast Player</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.artWrap}>
        {currentSong.album_art ? (
          <Image source={{ uri: currentSong.album_art }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Ionicons name="radio" size={64} color="#9070e9" />
          </View>
        )}
      </View>

      <Text style={styles.title} numberOfLines={3}>
        {cleanTitle(currentSong.title)}
      </Text>
      <Text style={styles.artist} numberOfLines={1}>
        {currentSong.artist || "Unknown"}
      </Text>

      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={() => setPlaybackError(null)}>
          <Ionicons name="alert-circle" size={16} color="#ff6b6b" />
          <Text style={styles.errorBannerText} numberOfLines={2}>
            {error}
          </Text>
        </TouchableOpacity>
      )}

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

      <View style={styles.timeRow}>
        <Text style={styles.time}>{fmtTime(live)}</Text>
        <Text style={styles.time}>{fmtTime(duration)}</Text>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={previous}>
          <Ionicons name="play-skip-back" size={34} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.mainBtn} onPress={togglePlayPause}>
          {buffering ? (
            <ActivityIndicator size="small" color="#16213e" />
          ) : (
            <Ionicons
              name={isPlaying ? "pause" : "play"}
              size={38}
              color="#16213e"
              style={!isPlaying ? styles.playIconNudge : undefined}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlBtn} onPress={next}>
          <Ionicons name="play-skip-forward" size={34} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.speedSection}>
        <Text style={styles.speedLabel}>Playback Speed</Text>
        <View style={styles.speedRow}>
          {SPEEDS.map((value) => {
            const active = Math.abs(rate - value) < 0.001;
            return (
              <TouchableOpacity
                key={value}
                style={[styles.speedBtn, active && styles.speedBtnActive]}
                onPress={() => handleRate(value)}
              >
                <Text
                  style={[styles.speedText, active && styles.speedTextActive]}
                >
                  {value === 1 ? "1x" : `${value}x`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.upNext}>
        <Text style={styles.upNextLabel}>Up Next</Text>
        {nextSong ? (
          <Text style={styles.upNextTitle} numberOfLines={1}>
            {cleanTitle(nextSong.title)}
          </Text>
        ) : (
          <Text style={styles.upNextNone}>End of queue</Text>
        )}
        <TouchableOpacity
          style={styles.queueLink}
          onPress={() => router.navigate("/(tabs)/music/playing" as any)}
        >
          <Ionicons name="list" size={14} color="#9070e9" />
          <Text style={styles.queueLinkText}>View Queue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(233, 69, 96, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(233, 69, 96, 0.4)",
  },
  errorBannerText: {
    flex: 1,
    color: "#ff6b6b",
    fontSize: 13,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#16213e",
  },
  heading: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  artWrap: {
    alignItems: "center",
    marginTop: 12,
    marginBottom: 24,
  },
  art: {
    width: 260,
    height: 260,
    borderRadius: 16,
  },
  artPlaceholder: {
    backgroundColor: "#16213e",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  artist: {
    color: "#888",
    fontSize: 15,
    marginTop: 6,
    textAlign: "center",
  },
  seekWrap: {
    width: "100%",
    height: 40,
    marginTop: 24,
  },
  progressTrack: {
    position: "absolute",
    top: 18,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "#333",
    borderRadius: 2,
  },
  progressFill: {
    position: "absolute",
    top: 18,
    left: 0,
    height: 4,
    backgroundColor: "#9070e9",
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    top: 11,
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: "#9070e9",
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
  },
  time: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 44,
    marginTop: 8,
  },
  controlBtn: {
    padding: 8,
  },
  mainBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  playIconNudge: {
    transform: [{ translateX: 3 }],
  },
  speedSection: {
    marginTop: 36,
  },
  speedLabel: {
    color: "#888",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
    marginBottom: 12,
  },
  speedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  speedBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#16213e",
    alignItems: "center",
  },
  speedBtnActive: {
    backgroundColor: "#9070e9",
  },
  speedText: {
    color: "#888",
    fontSize: 14,
    fontWeight: "600",
  },
  speedTextActive: {
    color: "#fff",
  },
  upNext: {
    marginTop: "auto",
    paddingBottom: 40,
    alignItems: "center",
  },
  upNextLabel: {
    color: "#888",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  upNextTitle: {
    color: "#fff",
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
  },
  upNextNone: {
    color: "#555",
    fontSize: 14,
    marginTop: 6,
  },
  queueLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    padding: 8,
  },
  queueLinkText: {
    color: "#9070e9",
    fontSize: 14,
    fontWeight: "600",
  },
});