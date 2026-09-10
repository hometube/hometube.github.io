import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useVideoStore } from "@/stores/videoStore";
import type { Video } from "@/types";
import Ionicons from "@expo/vector-icons/Ionicons";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "my-feed", label: "My Feed" },
  { key: "unwatched", label: "Unwatched" },
];

export default function VideoFeed() {
  const { user } = useUserStore();
  const videos = useVideoStore((s) => s.videos);
  const currentFilter = useVideoStore((s) => s.currentFilter);
  const isLoading = useVideoStore((s) => s.isLoading);
  const loadVideos = useVideoStore((s) => s.loadVideos);
  const setFilter = useVideoStore((s) => s.setFilter);
  const markWatched = useVideoStore((s) => s.markWatched);
  const toggleKeep = useVideoStore((s) => s.toggleKeep);
  const downloadVideo = useVideoStore((s) => s.downloadVideo);
  const deleteVideo = useVideoStore((s) => s.deleteVideo);

  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (user) {
      loadVideos(user.id);
    }
  }, [user, currentFilter]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user) await loadVideos(user.id);
    setRefreshing(false);
  }, [user]);

  const exitSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setFocused(false);
  }, []);

  const searching = focused || query.trim().length > 0;

  const filteredVideos = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return [];
    const out: Video[] = [];
    const seen = new Set<number>();
    for (const v of videos) {
      if (seen.has(v.id)) continue;
      if (
        (v.title || "").toLowerCase().includes(q) ||
        (v.channel_name || "").toLowerCase().includes(q)
      ) {
        seen.add(v.id);
        out.push(v);
      }
    }
    return out;
  }, [debouncedQuery, videos]);

  const handleVideoPress = useCallback((video: Video) => {
    router.push(`/(tabs)/videos/${video.id}`);
  }, []);

  const handleVideoLongPress = useCallback(
    (video: Video) => {
      Alert.alert(video.title, undefined, [
        {
          text: video.watched_at ? "Mark Unwatched" : "Mark Watched",
          onPress: () => markWatched(video.id),
        },
        {
          text: video.keep_flag ? "Unkeep" : "Keep",
          onPress: () => toggleKeep(video.id),
        },
        {
          text: "Download",
          onPress: () => downloadVideo(video.id),
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Alert.alert("Delete Video", "Are you sure?", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => deleteVideo(video.id) },
            ]);
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [markWatched, toggleKeep, downloadVideo, deleteVideo]
  );

  const renderVideo = useCallback(
    ({ item }: { item: Video }) => (
      <TouchableOpacity
        style={styles.videoCard}
        onPress={() => handleVideoPress(item)}
        onLongPress={() => handleVideoLongPress(item)}
      >
      <View style={styles.videoThumb}>
        <Ionicons name="videocam" size={32} color="#555" />
        {item.watched_at && (
          <View style={styles.watchedBadge}>
            <Ionicons name="checkmark" size={12} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.videoInfo}>
        <Text style={styles.videoTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {item.channel_name && (
          <Text style={styles.channelName}>{item.channel_name}</Text>
        )}
        <View style={styles.videoMeta}>
          {item.keep_flag && (
            <Ionicons name="bookmark" size={14} color="#e94560" />
          )}
          {item.downloaded && (
            <Ionicons name="download" size={14} color="#4ecca3" />
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#444" />
    </TouchableOpacity>
    ),
    [handleVideoPress, handleVideoLongPress]
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color="#666" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search videos by title or channel…"
            placeholderTextColor="#666"
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQuery("");
                setFocused(true);
              }}
            >
              <Ionicons name="close-circle" size={16} color="#666" />
            </TouchableOpacity>
          )}
        </View>
        {searching ? (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={exitSearch}
            accessibilityLabel="Exit search"
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => router.push("/(tabs)/videos/add")}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {!searching && (
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterBtn,
                currentFilter === f.key && styles.filterBtnActive,
              ]}
              onPress={() => {
                setFilter(f.key as any);
                if (user) loadVideos(user.id, f.key);
              }}
            >
              <Text
                style={[
                  styles.filterText,
                  currentFilter === f.key && styles.filterTextActive,
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {searching ? (
        query.trim().length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search" size={48} color="#444" />
            <Text style={styles.emptyText}>Type to search</Text>
            <Text style={styles.emptyHint}>Search by video title or channel</Text>
          </View>
        ) : filteredVideos.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="videocam-outline" size={48} color="#444" />
            <Text style={styles.emptyText}>No matches</Text>
            <Text style={styles.emptyHint}>Try a different search</Text>
          </View>
        ) : (
          <FlashList
            data={filteredVideos}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderVideo}
            ListHeaderComponent={
              <Text style={styles.resultsLabel}>
                {filteredVideos.length} result{filteredVideos.length === 1 ? "" : "s"}
              </Text>
            }
            contentContainerStyle={{ paddingBottom: 20 }}
          />
        )
      ) : isLoading && videos.length === 0 ? (
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      ) : videos.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="videocam-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>No videos yet</Text>
          <Text style={styles.emptyHint}>Tap + to add a video</Text>
        </View>
      ) : (
        <FlashList
          data={videos}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderVideo}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#e94560"
            />
          }
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  resultsLabel: {
    color: "#888",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    paddingBottom: 0,
  },
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 6,
    height: 36,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, padding: 0 },
  filterRow: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
    alignItems: "center",
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#16213e",
  },
  filterBtnActive: { backgroundColor: "#e94560" },
  filterText: { color: "#888", fontSize: 13 },
  filterTextActive: { color: "#fff", fontWeight: "600" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e94560",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  videoCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16213e",
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    padding: 12,
  },
  videoThumb: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: "#0f3460",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  watchedBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#4ecca3",
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  videoInfo: { flex: 1 },
  videoTitle: { color: "#fff", fontSize: 14, fontWeight: "500", marginBottom: 4 },
  channelName: { color: "#888", fontSize: 12, marginBottom: 2 },
  videoMeta: { flexDirection: "row", gap: 8, marginTop: 2 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#666", fontSize: 16, marginTop: 12 },
  emptyHint: { color: "#444", fontSize: 13, marginTop: 4 },
});
