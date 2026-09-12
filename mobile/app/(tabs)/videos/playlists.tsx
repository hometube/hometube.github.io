import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoStore } from "@/stores/videoStore";
import { useUserStore } from "@/stores/userStore";
import Ionicons from "@expo/vector-icons/Ionicons";

interface VideoPlaylist {
  id: number;
  name: string;
  songs: { video_id?: number; music_id?: number; type?: string }[];
}

export default function VideoPlaylists() {
  const { user } = useUserStore();
  const videoPlaylists = useVideoStore((s) => s.videoPlaylists);
  const videos = useVideoStore((s) => s.videos);
  const loadVideoPlaylists = useVideoStore((s) => s.loadVideoPlaylists);
  const createVideoPlaylist = useVideoStore((s) => s.createVideoPlaylist);
  const addVideoToPlaylist = useVideoStore((s) => s.addVideoToPlaylist);
  const deleteVideoPlaylist = useVideoStore((s) => s.deleteVideoPlaylist);

  const { addVideoId } = useLocalSearchParams<{ addVideoId?: string }>();

  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (user) {
      loadVideoPlaylists(user.id).finally(() => setLoading(false));
    }
  }, [user]);

  useEffect(() => {
    if (addVideoId && videoPlaylists.length > 0) {
      const target = videos.find((v) => v.id === Number(addVideoId));
      Alert.alert(
        "Add to Playlist",
        `Add "${target?.title || "video"}" to a playlist?`,
        [
          ...videoPlaylists.map((p) => ({
            text: p.name,
            onPress: () =>
              addVideoToPlaylist(p.id, Number(addVideoId)).then(() =>
                Alert.alert("Added", `Added to "${p.name}"`)
              ),
          })),
          {
            text: "New Playlist…",
            onPress: () => setModalOpen(true),
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
    }
  }, [addVideoId, videoPlaylists, videos]);

  const handleCreate = async () => {
    if (!user || !name.trim()) return;
    await createVideoPlaylist(name.trim(), user.id);
    setName("");
    setModalOpen(false);
    if (addVideoId) {
      const pl = useVideoStore.getState().videoPlaylists.find(
        (p) => p.name === name.trim()
      );
      if (pl) await addVideoToPlaylist(pl.id, Number(addVideoId));
      router.setParams({});
    }
  };

  const checkDelete = (p: VideoPlaylist) => {
    Alert.alert("Delete Playlist", `Delete "${p.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteVideoPlaylist(p.id),
      },
    ]);
  };

  const renderItem = useCallback(
    ({ item }: { item: VideoPlaylist }) => {
      const count = (item.songs || []).filter(
        (s) => s.type === "video" && s.video_id
      ).length;
      return (
        <TouchableOpacity
          style={styles.card}
          onPress={() =>
            router.push({
              pathname: "/(tabs)/videos/playlist/[id]",
              params: { id: String(item.id) },
            })
          }
          onLongPress={() => checkDelete(item)}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="list" size={22} color="#4ecca3" />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.cardSub}>{count} videos</Text>
          </View>
          <TouchableOpacity
            style={styles.addVideoBtn}
            onPress={() =>
              Alert.alert("Add Video", "No video selected to add yet.", [
                { text: "OK" },
              ])
            }
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
          <Ionicons name="chevron-forward" size={18} color="#444" />
        </TouchableOpacity>
      );
    },
    [videoPlaylists]
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push("/(tabs)/videos")}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Video Playlists</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setModalOpen(true)}>
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      {videoPlaylists.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="list-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>No playlists yet</Text>
          <Text style={styles.emptyHint}>Tap + to create your first video playlist</Text>
        </View>
      ) : (
        <FlatList
          data={videoPlaylists.slice()}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}

      <Modal visible={modalOpen} transparent animationType="slide">
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Playlist</Text>
            <TextInput
              style={styles.input}
              placeholder="Playlist name"
              placeholderTextColor="#666"
              value={name}
              onChangeText={setName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, !name.trim() && { opacity: 0.5 }]}
                disabled={!name.trim()}
                onPress={handleCreate}
              >
                <Text style={styles.confirmText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
    paddingTop: 52,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "700" },
  addBtn: { padding: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16213e",
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    padding: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0f3460",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  cardInfo: { flex: 1 },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  cardSub: { color: "#888", fontSize: 13, marginTop: 2 },
  addVideoBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#0f3460",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#666", fontSize: 16, marginTop: 12 },
  emptyHint: { color: "#444", fontSize: 13, marginTop: 4 },
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: "#16213e",
    borderRadius: 14,
    padding: 20,
  },
  modalTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 16 },
  input: {
    backgroundColor: "#0f3460",
    borderRadius: 10,
    padding: 12,
    color: "#fff",
    fontSize: 15,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  cancelBtn: { padding: 12 },
  cancelText: { color: "#888", fontSize: 15 },
  confirmBtn: { padding: 12 },
  confirmText: { color: "#e94560", fontSize: 15, fontWeight: "600" },
});