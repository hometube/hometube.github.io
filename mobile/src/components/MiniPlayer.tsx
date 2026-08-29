import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router, usePathname } from "expo-router";
import { useProgress } from "react-native-track-player";
import { Ionicons } from "@expo/vector-icons";
import { useMusicStore, cleanTitle } from "@/stores/musicStore";

export default function MiniPlayer() {
  const pathname = usePathname();
  const progress = useProgress(1000);
  const {
    queue,
    currentIndex,
    playlists,
    playlistId,
    isPlaying,
    repeat,
    togglePlayPause,
    next,
    previous,
    toggleRepeat,
  } = useMusicStore();

  const currentSong = currentIndex >= 0 ? queue[currentIndex] : null;
  if (!currentSong) return null;

  if (pathname === "/(tabs)/music/now-playing") return null;

  const duration = progress.duration || 0;
  const position = progress.position || 0;
  const progressPercent = duration > 0 ? Math.min((position / duration) * 100, 100) : 0;

  const playlistName =
    playlistId === "-1"
      ? "All Songs"
      : playlistId === "-2"
      ? "My Songs"
      : playlists.find((p) => String(p.id) === playlistId)?.name;

  const onCurrentPlaylist =
    !!playlistId && pathname.includes(`/music/playlist/${playlistId}`);

  const goToCurrentPlaylist = () => {
    if (!playlistId) return;
    const nameQuery = playlistName ? `?name=${encodeURIComponent(playlistName)}` : "";
    router.push(`/(tabs)/music/playlist/${playlistId}${nameQuery}` as any);
  };

  return (
    <TouchableOpacity
      style={styles.container}
      activeOpacity={0.9}
      onPress={() => router.push("/(tabs)/music/now-playing" as any)}
    >
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
      </View>

      <Text style={styles.marquee} numberOfLines={1}>
        {cleanTitle(currentSong.title)}
        {currentSong.artist ? `  •  ${currentSong.artist}` : ""}
      </Text>

      <View style={styles.row}>
        <TouchableOpacity
          style={styles.control}
          onPress={(e) => {
            e.stopPropagation();
            goToCurrentPlaylist();
          }}
          disabled={!playlistId}
        >
          <Ionicons
            name="eye"
            size={20}
            color={onCurrentPlaylist ? "#666" : "#fff"}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.control}
          onPress={(e) => {
            e.stopPropagation();
            previous();
          }}
        >
          <Ionicons name="play-skip-back" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.mainBtn}
          onPress={(e) => {
            e.stopPropagation();
            togglePlayPause();
          }}
        >
          <Ionicons name={isPlaying ? "pause" : "play"} size={24} color="#16213e" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.control}
          onPress={(e) => {
            e.stopPropagation();
            next();
          }}
        >
          <Ionicons name="play-skip-forward" size={22} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.control}
          onPress={(e) => {
            e.stopPropagation();
            toggleRepeat();
          }}
        >
          <Ionicons name="repeat" size={20} color={repeat ? "#e94560" : "#666"} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#16213e",
    borderTopWidth: 1,
    borderTopColor: "#0f3460",
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 14,
    zIndex: 90,
    elevation: 8,
  },
  progressTrack: {
    height: 3,
    backgroundColor: "#333",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#e94560",
    borderRadius: 2,
  },
  marquee: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 28,
  },
  control: {
    padding: 6,
  },
  mainBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
});