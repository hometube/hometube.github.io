import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useMusicStore } from "@/stores/musicStore";
import { Ionicons } from "@expo/vector-icons";
import type { Playlist } from "@/types";

export default function MusicHome() {
  const { user } = useUserStore();
  const { playlists, music, isLoading, loadPlaylists, loadMusic } = useMusicStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) {
      loadPlaylists(user.id);
      loadMusic(user.id);
    }
  }, [user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user) {
      await loadPlaylists(user.id);
      await loadMusic(user.id);
    }
    setRefreshing(false);
  }, [user]);

  const virtualPlaylists = user
    ? [
        {
          id: -1,
          name: "All Songs",
          user_id: user.id,
          created_at: "",
          songs: music.map((m) => ({ music_id: m.id, position: 0 })),
          _virtual: true,
        },
        {
          id: -2,
          name: "My Songs",
          user_id: user.id,
          created_at: "",
          songs: music
            .filter((m) => m.added_by === user.id)
            .map((m) => ({ music_id: m.id, position: 0 })),
          _virtual: true,
        },
      ]
    : [];

  const allPlaylists = [...virtualPlaylists, ...playlists];

  const handlePlaylistPress = (playlist: any) => {
    if (playlist._virtual || playlist.id > 0) {
      router.push(
        `/(tabs)/music/playlist/${playlist.id}?name=${encodeURIComponent(playlist.name)}`
      );
    }
  };

  const handleAddPress = () => {
    router.push("/(tabs)/music/add");
  };

  const renderPlaylist = ({ item }: { item: Playlist & { _virtual?: boolean } }) => (
    <TouchableOpacity
      style={styles.playlistCard}
      onPress={() => handlePlaylistPress(item)}
    >
      <View style={[styles.playlistIcon, item._virtual && styles.virtualIcon]}>
        <Ionicons
          name={item._virtual ? "musical-notes" : "folder"}
          size={24}
          color={item._virtual ? "#4ecca3" : "#e94560"}
        />
      </View>
      <View style={styles.playlistInfo}>
        <Text style={styles.playlistName}>{item.name}</Text>
        <Text style={styles.songCount}>
          {item.songs?.length || 0} songs
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#444" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Playlists</Text>
        <TouchableOpacity style={styles.addBtn} onPress={handleAddPress}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {isLoading && playlists.length === 0 ? (
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      ) : allPlaylists.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="musical-notes-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>No music yet</Text>
          <Text style={styles.emptyHint}>Tap + to add music or import data</Text>
        </View>
      ) : (
        <FlatList
          data={allPlaylists}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderPlaylist}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#e94560"
            />
          }
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingBottom: 8,
  },
  heading: { color: "#fff", fontSize: 20, fontWeight: "700" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e94560",
    justifyContent: "center",
    alignItems: "center",
  },
  playlistCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  playlistIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#0f3460",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  virtualIcon: { backgroundColor: "rgba(78,204,163,0.15)" },
  playlistInfo: { flex: 1 },
  playlistName: { color: "#fff", fontSize: 16, fontWeight: "500", marginBottom: 2 },
  songCount: { color: "#888", fontSize: 12 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#666", fontSize: 16, marginTop: 12 },
  emptyHint: { color: "#444", fontSize: 13, marginTop: 4 },
});
