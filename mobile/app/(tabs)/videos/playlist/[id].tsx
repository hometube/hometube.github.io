import { useEffect, useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
  Image,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoStore, videoThumb } from "@/stores/videoStore";
import { useUserStore } from "@/stores/userStore";
import { API } from "@/api";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Video } from "@/types";

interface Member {
  song: any;
  video: Video;
}

export default function VideoPlaylistDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useUserStore();
  const videos = useVideoStore((s) => s.videos);
  const videoPlaylists = useVideoStore((s) => s.videoPlaylists);
  const loadVideoPlaylists = useVideoStore((s) => s.loadVideoPlaylists);
  const addVideoToPlaylist = useVideoStore((s) => s.addVideoToPlaylist);
  const removeVideoFromPlaylist = useVideoStore((s) => s.removeVideoFromPlaylist);
  const deleteVideoPlaylist = useVideoStore((s) => s.deleteVideoPlaylist);

  const [loading, setLoading] = useState(true);
  const [manage, setManage] = useState(false);
  const [localMembers, setLocalMembers] = useState<Member[]>([]);

  const playlist = videoPlaylists.find((p) => p.id === Number(id));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [id, videos.length, videoPlaylists.length]);

  const load = async () => {
    if (user) await loadVideoPlaylists(user.id);
  };

  useEffect(() => {
    if (!playlist) {
      setLocalMembers([]);
      return;
    }
    const byId = new Map(videos.map((v) => [v.id, v]));
    const members: Member[] = ((playlist.songs || []) as any[])
      .filter((s) => s && s.type === "video" && s.video_id)
      .map((s) => ({ song: s, video: byId.get(s.video_id) }))
      .filter((m: { song: any; video?: Video }): m is Member => !!m.video);
    setLocalMembers(members);
  }, [playlist, videos]);

  const playVideo = (v: Video) => {
    router.push({ pathname: "/(tabs)/videos/[id]", params: { id: String(v.id) } });
  };

  const playAll = () => {
    const first = localMembers[0]?.video;
    if (first) playVideo(first);
  };

  const removeMember = async (m: Member) => {
    await removeVideoFromPlaylist(Number(id), m.video.id);
  };

  const move = (idx: number, dir: number) => {
    const arr = [...localMembers];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    const reordered = arr.map((m, i) => ({
      video_id: m.video.id,
      position: i,
      type: "video",
    }));
    setLocalMembers(arr);
    API.put(`/playlists/${id}`, { songs: reordered }).catch(() => {});
  };

  const rename = () => {
    if (!playlist) return;
    Alert.prompt?.("Rename Playlist", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (name?: string) => {
          if (name && user) {
            API.put(`/playlists/${id}`, { name }).then(() => loadVideoPlaylists(user.id));
          }
        },
      },
    ], "plain-text", playlist.name);
  };

  const checkDelete = () => {
    Alert.alert("Delete Playlist", `Delete "${playlist?.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteVideoPlaylist(Number(id)).then(() => router.back()),
      },
    ]);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: Member; index: number }) => (
      <View style={styles.card}>
        <TouchableOpacity style={styles.thumbWrap} onPress={() => playVideo(item.video)}>
          <View style={styles.thumb}>
            {videoThumb(item.video) ? (
              <Image source={{ uri: videoThumb(item.video) }} style={styles.thumbImage} />
            ) : (
              <Ionicons name="videocam" size={20} color="#555" />
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => playVideo(item.video)}>
          <Text style={styles.title} numberOfLines={2}>{item.video.title}</Text>
          <View style={styles.metaRow}>
            {item.video.watched_at ? (
              <Ionicons name="checkmark-circle" size={13} color="#4ecca3" />
            ) : item.video.position ? (
              <Text style={styles.resume}>{Math.round(item.video.position / 60)}m in</Text>
            ) : null}
            {item.video.downloaded ? (
              <Ionicons name="download" size={13} color="#4ecca3" />
            ) : null}
          </View>
        </TouchableOpacity>
        {manage ? (
          <View style={styles.moveCol}>
            <TouchableOpacity disabled={index === 0} onPress={() => move(index, -1)} style={styles.moveBtn}>
              <Ionicons name="chevron-up" size={18} color={index === 0 ? "#333" : "#fff"} />
            </TouchableOpacity>
            <TouchableOpacity
              disabled={index === localMembers.length - 1}
              onPress={() => move(index, 1)}
              style={styles.moveBtn}
            >
              <Ionicons
                name="chevron-down"
                size={18}
                color={index === localMembers.length - 1 ? "#333" : "#fff"}
              />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => removeMember(item)} style={styles.removeBtn}>
            <Ionicons name="close" size={18} color="#e94560" />
          </TouchableOpacity>
        )}
      </View>
    ),
    [manage, localMembers]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {playlist?.name || "Playlist"}
        </Text>
        <TouchableOpacity style={styles.renameBtn} onPress={rename}>
          <Ionicons name="pencil" size={20} color="#aaa" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={checkDelete}>
          <Ionicons name="trash" size={20} color="#e94560" />
        </TouchableOpacity>
      </View>

      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.playAllBtn} onPress={playAll}>
          <Ionicons name="play" size={16} color="#fff" />
          <Text style={styles.playAllText}>
            {localMembers.length > 0 ? "Play All" : "Empty"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.manageBtn, manage && styles.manageBtnActive]}
          onPress={() => setManage(!manage)}
        >
          <Ionicons name="reorder-three" size={18} color="#fff" />
          <Text style={styles.manageText}>{manage ? "Done" : "Manage"}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      ) : localMembers.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="albums-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>No videos in this playlist</Text>
          <Text style={styles.emptyHint}>
            Long-press a video in the feed → Add to Playlist
          </Text>
        </View>
      ) : (
        <FlatList
          data={localMembers}
          keyExtractor={(item) => String(item.video.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingTop: 52,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "700" },
  renameBtn: { padding: 4 },
  deleteBtn: { padding: 4 },
  toolbar: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  playAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#e94560",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  playAllText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  manageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#16213e",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  manageBtnActive: { backgroundColor: "#0f3460" },
  manageText: { color: "#fff", fontSize: 13 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16213e",
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    padding: 10,
  },
  thumbWrap: { marginRight: 12 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: "#0f3460",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbText: { color: "#fff", fontSize: 18 },
  title: { color: "#fff", fontSize: 14, fontWeight: "500" },
  metaRow: { flexDirection: "row", gap: 6, marginTop: 4, alignItems: "center" },
  resume: { color: "#4ecca3", fontSize: 12 },
  moveCol: { flexDirection: "row" },
  moveBtn: { padding: 6 },
  removeBtn: { padding: 8 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#666", fontSize: 16, marginTop: 12 },
  emptyHint: { color: "#444", fontSize: 13, marginTop: 4, textAlign: "center", paddingHorizontal: 24 },
});