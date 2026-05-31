import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useVideoStore } from "@/stores/videoStore";
import type { Video } from "@/types";
import { Ionicons } from "@expo/vector-icons";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "my-feed", label: "My Feed" },
  { key: "unwatched", label: "Unwatched" },
];

export default function VideoFeed() {
  const { user } = useUserStore();
  const {
    videos,
    currentFilter,
    isLoading,
    loadVideos,
    setFilter,
    markWatched,
    toggleKeep,
    downloadVideo,
    deleteVideo,
  } = useVideoStore();

  const [refreshing, setRefreshing] = useState(false);

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

  const handleVideoPress = (video: Video) => {
    router.push(`/(tabs)/videos/${video.id}`);
  };

  const handleVideoLongPress = (video: Video) => {
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
  };

  const renderVideo = ({ item }: { item: Video }) => (
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
  );

  return (
    <View style={styles.container}>
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
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/(tabs)/videos/add")}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {isLoading && videos.length === 0 ? (
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      ) : videos.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="videocam-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>No videos yet</Text>
          <Text style={styles.emptyHint}>Tap + to add a video</Text>
        </View>
      ) : (
        <FlatList
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
    marginLeft: "auto",
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
