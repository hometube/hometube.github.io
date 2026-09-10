import { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
  TextInput,
  FlatList,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { API, isLocalModeAsync } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { usePodcastStore } from "@/stores/podcastStore";
import { useMusicStore } from "@/stores/musicStore";
import { useDownloadStore } from "@/stores/downloadStore";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Music, Playlist } from "@/types";

export default function PodcastPlaylistView() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { user } = useUserStore();
  const playlists = usePodcastStore((s) => s.playlists);
  const load = usePodcastStore((s) => s.load);

  const queue = useMusicStore((s) => s.queue);
  const currentIndex = useMusicStore((s) => s.currentIndex);
  const loadPlaylistSongs = useMusicStore((s) => s.loadPlaylistSongs);
  const playSong = useMusicStore((s) => s.playSong);
  const playFirst = useMusicStore((s) => s.playFirst);
  const shufflePlay = useMusicStore((s) => s.shufflePlay);
  const addToQueue = useMusicStore((s) => s.addToQueue);
  const playNow = useMusicStore((s) => s.playNow);
  const isInQueue = useMusicStore((s) => s.isInQueue);
  const removeFromQueue = useMusicStore((s) => s.removeFromQueue);

  const isDownloading = useDownloadStore((s) => s.isDownloading);
  const downloadForOffline = useDownloadStore((s) => s.downloadForOffline);

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songs, setSongs] = useState<Music[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLocal, setIsLocal] = useState(false);
  const [menuSong, setMenuSong] = useState<Music | null>(null);
  const [showRename, setShowRename] = useState(false);
  const [renameName, setRenameName] = useState("");

  const playlistId = String(playlist?.id ?? id);
  const activeId = currentIndex >= 0 ? queue[currentIndex]?.id ?? null : null;

  useEffect(() => {
    isLocalModeAsync().then(setIsLocal);
    if (user) load(user.id);
  }, [user]);

  useEffect(() => {
    const p = playlists.find((pl) => pl.id === Number(id));
    setPlaylist(p ?? null);
    if (p && user) {
      setLoading(true);
      API.get("/music", {
        user_id: user.id,
        playlist_id: p.id,
        kind: "podcast",
      })
        .then((music) => setSongs(music as Music[]))
        .catch(() => setSongs([]))
        .finally(() => setLoading(false));
    } else {
      setSongs([]);
      setLoading(false);
    }
  }, [id, playlists, user]);

  const playableSongs = useMemo(
    () => (isLocal ? songs.filter((s) => s.downloaded) : songs),
    [isLocal, songs]
  );

  const handlePlayAll = async () => {
    if (songs.length === 0) return;
    const wasEmpty = useMusicStore.getState().queue.length === 0;
    await loadPlaylistSongs(playableSongs, playlistId);
    await playFirst();
    if (wasEmpty) router.navigate("/(tabs)/music/playing" as any);
  };

  const handleShuffle = async () => {
    if (songs.length === 0) return;
    const wasEmpty = useMusicStore.getState().queue.length === 0;
    await loadPlaylistSongs(playableSongs, playlistId);
    await shufflePlay();
    if (wasEmpty) router.navigate("/(tabs)/music/playing" as any);
  };

  const handleSongPress = async (index: number) => {
    const song = songs[index];
    if (isLocal && !song.downloaded) return;
    await loadPlaylistSongs(playableSongs, playlistId);
    const store = useMusicStore.getState();
    const queueIndex = store.queue.findIndex((s) => s.id === song.id);
    await playSong(queueIndex >= 0 ? queueIndex : 0);
  };

  const handleRemove = async (song: Music) => {
    try {
      await API.delete(`/playlists/${playlist!.id}/remove/${song.id}`);
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const handleDelete = () => {
    Alert.alert("Delete Playlist", `Delete "${playlist?.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await API.delete(`/playlists/${playlist!.id}`);
            if (user) load(user.id, true);
            router.back();
          } catch (err: any) {
            Alert.alert("Error", err.message);
          }
        },
      },
    ]);
  };

  const handleRename = async () => {
    if (!playlist) return;
    const value = renameName.trim();
    if (!value || value === playlist.name) {
      setShowRename(false);
      return;
    }
    try {
      await API.put(`/playlists/${playlist.id}`, { name: value });
      if (user) load(user.id, true);
      setShowRename(false);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const songMenuItems = (song: Music) => {
    const inQueue = isInQueue(song.id);
    const items: { icon: string; label: string; onPress: () => void; destructive?: boolean }[] = [
      { icon: "play", label: "Play Now", onPress: () => playNow(song) },
    ];
    if (!inQueue) {
      items.push({ icon: "add", label: "Add to Queue", onPress: () => addToQueue(song) });
    } else {
      items.push({
        icon: "remove-circle",
        label: "Remove from Queue",
        onPress: () => removeFromQueue(song.id),
      });
    }
    if (!isLocal && !song.downloaded && !isDownloading) {
      items.push({
        icon: "download",
        label: "Download",
        onPress: () => downloadForOffline([song]),
      });
    }
    items.push({
      icon: "trash",
      label: "Remove from Playlist",
      onPress: () => handleRemove(song),
      destructive: true,
    });
    return items;
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#9070e9" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {songs.length > 0 && (
        <View style={styles.header}>
          {songs[0]?.album_art ? (
            <Image source={{ uri: songs[0].album_art }} style={styles.albumArt} />
          ) : (
            <View style={styles.albumArtPlaceholder}>
              <Ionicons name="radio" size={40} color="#444" />
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{playlist?.name || name || "Playlist"}</Text>
            <Text style={styles.headerCount}>{songs.length} episodes</Text>
          </View>
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, songs.length === 0 && styles.disabled]}
          onPress={handlePlayAll}
          disabled={songs.length === 0}
        >
          <Ionicons name="play" size={20} color="#fff" />
          <Text style={styles.controlText}>Play</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, styles.shuffleBtn, songs.length === 0 && styles.disabled]}
          onPress={handleShuffle}
          disabled={songs.length === 0}
        >
          <Ionicons name="shuffle" size={20} color="#fff" />
          <Text style={styles.controlText}>Shuffle</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setShowRename(true)}>
          <Ionicons name="pencil" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuBtn} onPress={handleDelete}>
          <Ionicons name="trash" size={18} color="#e94560" />
        </TouchableOpacity>
      </View>

      {songs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="albums-outline" size={40} color="#444" />
          <Text style={styles.emptyText}>No episodes in this playlist</Text>
        </View>
      ) : (
        <FlatList
          data={songs}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item, index }) => {
            const active = activeId === item.id;
            const disabled = isLocal && !item.downloaded;
            return (
              <TouchableOpacity
                style={[styles.songItem, active && styles.songItemActive, disabled && styles.songItemDisabled]}
                onPress={() => (isLocal && !item.downloaded ? null : handleSongPress(index))}
                onLongPress={() => setMenuSong(item)}
                delayLongPress={350}
              >
                {item.album_art ? (
                  <Image source={{ uri: item.album_art }} style={styles.albumArtSmall} />
                ) : (
                  <View style={styles.albumArtPlaceholderSmall}>
                    <Ionicons name="radio" size={16} color="#555" />
                  </View>
                )}
                <View style={styles.songInfo}>
                  <Text
                    style={[styles.songTitle, active && styles.songTitleActive, disabled && styles.songTitleDisabled]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  <Text style={[styles.songArtist, disabled && styles.songTitleDisabled]} numberOfLines={1}>
                    {item.artist || "Unknown"}
                  </Text>
                </View>
                {item.downloaded && (
                  <Ionicons name="checkmark-circle" size={16} color="#4ecca3" />
                )}
                <TouchableOpacity
                  style={styles.rowMenuBtn}
                  onPress={() => setMenuSong(item)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color="#666" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={{ paddingBottom: 120 }}
        />
      )}

      <Modal
        visible={!!menuSong}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuSong(null)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setMenuSong(null)}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {menuSong?.title || ""}
            </Text>
            {menuSong &&
              songMenuItems(menuSong).map((item, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.sheetItem}
                  onPress={() => {
                    setMenuSong(null);
                    item.onPress();
                  }}
                >
                  <Ionicons name={item.icon as any} size={22} color={item.destructive ? "#e94560" : "#fff"} />
                  <Text style={[styles.sheetLabel, item.destructive && { color: "#e94560" }]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={showRename}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRename(false)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowRename(false)}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Rename Playlist</Text>
            <TextInput
              style={styles.renameInput}
              placeholder="Playlist name"
              placeholderTextColor="#666"
              value={renameName}
              onChangeText={setRenameName}
              autoFocus
              maxLength={100}
            />
            <View style={styles.renameActions}>
              <TouchableOpacity
                style={[styles.renameBtn, styles.renameCancelBtn]}
                onPress={() => setShowRename(false)}
              >
                <Text style={styles.renameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.renameBtn, styles.renameSaveBtn, !renameName.trim() && styles.renameBtnDisabled]}
                onPress={handleRename}
                disabled={!renameName.trim()}
              >
                <Text style={styles.renameSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
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
    padding: 16,
    alignItems: "center",
    gap: 16,
  },
  albumArt: { width: 80, height: 80, borderRadius: 12 },
  albumArtPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: "#16213e",
    justifyContent: "center",
    alignItems: "center",
  },
  headerInfo: { flex: 1 },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  headerCount: { color: "#888", fontSize: 14, marginTop: 4 },
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
  menuBtn: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#16213e",
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  disabled: { opacity: 0.4 },
  controlText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  songItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  songItemActive: { backgroundColor: "rgba(144,112,233,0.1)" },
  songItemDisabled: { opacity: 0.45 },
  albumArtSmall: { width: 40, height: 40, borderRadius: 6 },
  albumArtPlaceholderSmall: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: "#16213e",
    justifyContent: "center",
    alignItems: "center",
  },
  songInfo: { flex: 1 },
  songTitle: { color: "#fff", fontSize: 14, fontWeight: "500" },
  songTitleActive: { color: "#c4a9ff" },
  songTitleDisabled: { color: "#555" },
  songArtist: { color: "#888", fontSize: 12, marginTop: 2 },
  rowMenuBtn: { padding: 6 },
  empty: { justifyContent: "center", alignItems: "center", paddingTop: 60 },
  emptyText: { color: "#666", fontSize: 16, marginTop: 12 },
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
  sheetLabel: { color: "#fff", fontSize: 16 },
  renameInput: {
    backgroundColor: "#0f3460",
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    color: "#fff",
    marginBottom: 16,
  },
  renameActions: {
    flexDirection: "row",
    gap: 12,
  },
  renameBtn: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  renameCancelBtn: { backgroundColor: "#0f3460" },
  renameCancelText: { color: "#888", fontSize: 16, fontWeight: "600" },
  renameSaveBtn: { backgroundColor: "#9070e9" },
  renameSaveText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  renameBtnDisabled: { opacity: 0.6 },
});