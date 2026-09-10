import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { isLocalModeAsync } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { usePodcastStore } from "@/stores/podcastStore";
import { useMusicStore } from "@/stores/musicStore";
import { useDownloadStore } from "@/stores/downloadStore";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Music } from "@/types";

export default function PodcastFeedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const subscriptionId = Number(id);
  const { user } = useUserStore();
  const feeds = usePodcastStore((s) => s.feeds);
  const episodes = usePodcastStore((s) => s.episodes);
  const isLoading = usePodcastStore((s) => s.isLoading);
  const isChecking = usePodcastStore((s) => s.isChecking);
  const loadEpisodes = usePodcastStore((s) => s.loadEpisodes);
  const checkNow = usePodcastStore((s) => s.checkNow);
  const unsubscribe = usePodcastStore((s) => s.unsubscribe);
  const load = usePodcastStore((s) => s.load);

  const queue = useMusicStore((s) => s.queue);
  const currentIndex = useMusicStore((s) => s.currentIndex);
  const loadPlaylistSongs = useMusicStore((s) => s.loadPlaylistSongs);
  const playSong = useMusicStore((s) => s.playSong);
  const playFirst = useMusicStore((s) => s.playFirst);
  const shufflePlay = useMusicStore((s) => s.shufflePlay);
  const addToQueue = useMusicStore((s) => s.addToQueue);
  const playNow = useMusicStore((s) => s.playNow);

  const isDownloading = useDownloadStore((s) => s.isDownloading);
  const downloadForOffline = useDownloadStore((s) => s.downloadForOffline);

  const [isLocal, setIsLocal] = useState(false);
  const [menuEpisode, setMenuEpisode] = useState<Music | null>(null);

  const feed = feeds.find((f) => f.subscription_id === subscriptionId);
  const feedName = feed?.channel_name || "Podcast";
  const activeId = currentIndex >= 0 ? queue[currentIndex]?.id ?? null : null;
  const playlistId = `feed-${subscriptionId}`;

  useEffect(() => {
    isLocalModeAsync().then(setIsLocal);
  }, []);

  useEffect(() => {
    if (user && !isNaN(subscriptionId)) {
      loadEpisodes(subscriptionId).then(() => load(user.id, true));
    }
  }, [subscriptionId, user]);

  const playableEpisodes = isLocal
    ? episodes.filter((e) => e.downloaded)
    : episodes;

  const handlePlayAll = async () => {
    if (episodes.length === 0) return;
    const wasEmpty = useMusicStore.getState().queue.length === 0;
    await loadPlaylistSongs(playableEpisodes, playlistId);
    await playFirst();
    if (wasEmpty) router.navigate("/(tabs)/music/playing" as any);
  };

  const handleShuffle = async () => {
    if (episodes.length === 0) return;
    const wasEmpty = useMusicStore.getState().queue.length === 0;
    await loadPlaylistSongs(playableEpisodes, playlistId);
    await shufflePlay();
    if (wasEmpty) router.navigate("/(tabs)/music/playing" as any);
  };

  const handleEpisodePress = async (index: number) => {
    const episode = episodes[index];
    if (isLocal && !episode.downloaded) return;
    await loadPlaylistSongs(playableEpisodes, playlistId);
    const store = useMusicStore.getState();
    const queueIndex = store.queue.findIndex((s) => s.id === episode.id);
    await playSong(queueIndex >= 0 ? queueIndex : 0);
  };

  const handleCheckNow = async () => {
    await checkNow(subscriptionId);
    await loadEpisodes(subscriptionId);
  };

  const handleUnsubscribe = () => {
    Alert.alert(
      "Unsubscribe",
      `Unsubscribe from "${feedName}"? Episodes stay in your library.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unsubscribe",
          style: "destructive",
          onPress: async () => {
            await unsubscribe(subscriptionId);
            router.back();
          },
        },
      ]
    );
  };

  const handleDownload = async (episode: Music) => {
    try {
      await downloadForOffline([episode]);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const episodeMenuItems = (episode: Music) => [
    { icon: "play", label: "Play Now", color: "#fff", onPress: () => playNow(episode) },
    { icon: "add", label: "Add to Queue", color: "#fff", onPress: () => addToQueue(episode) },
    ...(!isLocal && !episode.downloaded
      ? [{ icon: "download", label: "Download", color: "#fff", onPress: () => handleDownload(episode) }]
      : []),
  ];

  const renderEpisode = useCallback(
    ({ item, index }: { item: Music; index: number }) => {
      const active = activeId === item.id;
      const disabled = isLocal && !item.downloaded;
      return (
        <TouchableOpacity
          style={[styles.episodeItem, active && styles.episodeItemActive, disabled && styles.episodeItemDisabled]}
          onPress={() => !isLocal || item.downloaded ? handleEpisodePress(index) : null}
          onLongPress={() => setMenuEpisode(item)}
          delayLongPress={350}
        >
          {item.album_art ? (
            <Image source={{ uri: item.album_art }} style={styles.episodeArt} />
          ) : (
            <View style={styles.episodeArtPlaceholder}>
              <Ionicons name="radio" size={16} color="#555" />
            </View>
          )}
          <View style={styles.episodeInfo}>
            <Text
              style={[styles.episodeTitle, active && styles.episodeTitleActive, disabled && styles.episodeTitleDisabled]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            <Text style={[styles.episodeArtist, disabled && styles.episodeTitleDisabled]} numberOfLines={1}>
              {item.artist || "Unknown"} · {new Date(item.created_at).toLocaleDateString()}
            </Text>
          </View>
          {item.downloaded && (
            <Ionicons name="checkmark-circle" size={16} color="#4ecca3" />
          )}
          <TouchableOpacity
            style={styles.rowMenuBtn}
            onPress={() => setMenuEpisode(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color="#666" />
          </TouchableOpacity>
        </TouchableOpacity>
      );
    },
    [activeId, isLocal, playableEpisodes]
  );

  if (isLoading && episodes.length === 0) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#9070e9" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {feedName}
          </Text>
          <Text style={styles.headerCount}>
            {episodes.length} episodes
          </Text>
        </View>
        <TouchableOpacity style={styles.checkBtn} onPress={handleCheckNow} disabled={isChecking}>
          {isChecking ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="refresh" size={18} color="#fff" />
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={handleUnsubscribe}>
          <Ionicons name="trash" size={18} color="#e94560" />
        </TouchableOpacity>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, episodes.length === 0 && styles.disabled]}
          onPress={handlePlayAll}
          disabled={episodes.length === 0}
        >
          <Ionicons name="play" size={20} color="#fff" />
          <Text style={styles.controlText}>Play All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, styles.shuffleBtn, episodes.length === 0 && styles.disabled]}
          onPress={handleShuffle}
          disabled={episodes.length === 0}
        >
          <Ionicons name="shuffle" size={20} color="#fff" />
          <Text style={styles.controlText}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      {isDownloading && (
        <View style={styles.downloadingBar}>
          <ActivityIndicator size="small" color="#9070e9" />
          <Text style={styles.downloadingText}>Downloading episodes…</Text>
        </View>
      )}

      {episodes.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="radio-outline" size={40} color="#444" />
          <Text style={styles.emptyText}>No episodes yet</Text>
          <Text style={styles.emptyHint}>Check for new episodes to pull them in</Text>
        </View>
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderEpisode}
          contentContainerStyle={{ paddingBottom: 120 }}
        />
      )}

      <Modal
        visible={!!menuEpisode}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuEpisode(null)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setMenuEpisode(null)}
        >
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {menuEpisode?.title || ""}
            </Text>
            {menuEpisode &&
              episodeMenuItems(menuEpisode).map((item, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.sheetItem}
                  onPress={() => {
                    setMenuEpisode(null);
                    item.onPress();
                  }}
                >
                  <Ionicons name={item.icon as any} size={22} color={item.color} />
                  <Text style={[styles.sheetLabel, { color: item.color }]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
  },
  headerInfo: { flex: 1 },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  headerCount: { color: "#888", fontSize: 13, marginTop: 4 },
  checkBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#9070e9",
    justifyContent: "center",
    alignItems: "center",
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(233,69,96,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  controls: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  controlBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#9070e9",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  shuffleBtn: { backgroundColor: "#0f3460" },
  disabled: { opacity: 0.4 },
  controlText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  downloadingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  downloadingText: { color: "#9070e9", fontSize: 12 },
  episodeItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  episodeItemActive: { backgroundColor: "rgba(144,112,233,0.1)" },
  episodeItemDisabled: { opacity: 0.45 },
  episodeArt: { width: 40, height: 40, borderRadius: 6 },
  episodeArtPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: "#16213e",
    justifyContent: "center",
    alignItems: "center",
  },
  episodeInfo: { flex: 1 },
  episodeTitle: { color: "#fff", fontSize: 14, fontWeight: "500" },
  episodeTitleActive: { color: "#c4a9ff" },
  episodeTitleDisabled: { color: "#555" },
  episodeArtist: { color: "#888", fontSize: 12, marginTop: 2 },
  rowMenuBtn: { padding: 6 },
  empty: { justifyContent: "center", alignItems: "center", paddingTop: 60 },
  emptyText: { color: "#666", fontSize: 16, marginTop: 12 },
  emptyHint: { color: "#444", fontSize: 13, marginTop: 4 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  bottomSheet: {
    backgroundColor: "#16213e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#333",
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
  },
  sheetLabel: { fontSize: 16 },
});