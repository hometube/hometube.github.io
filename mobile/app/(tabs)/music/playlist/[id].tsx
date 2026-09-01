import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
} from "react-native";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useLocalSearchParams, router } from "expo-router";
import { API, isLocalModeAsync } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useMusicStore } from "@/stores/musicStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useDownloadStore } from "@/stores/downloadStore";
import { Ionicons } from "@expo/vector-icons";
import type { Music, Playlist } from "@/types";

interface SongRowProps {
  item: Music;
  index: number;
  isLocal: boolean;
  manageMode: boolean;
  activeId: number | null;
  isLast: boolean;
  onSongPress: (index: number) => void;
  onLongPress: (item: Music) => void;
  onMenu: (item: Music) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

const SongRow = memo(function SongRow({
  item,
  index,
  isLocal,
  manageMode,
  activeId,
  isLast,
  onSongPress,
  onLongPress,
  onMenu,
  onMoveUp,
  onMoveDown,
}: SongRowProps) {
  const downloading = useDownloadStore((s) => s.downloadingIds.includes(item.id));
  const disabled = isLocal && !item.downloaded;
  const active = activeId === item.id;

  return (
    <TouchableOpacity
      style={[
        styles.songItem,
        active && styles.songItemActive,
        disabled && styles.songItemDisabled,
      ]}
      onPress={() => !manageMode && onSongPress(index)}
      onLongPress={() => !manageMode && onLongPress(item)}
      delayLongPress={350}
      disabled={disabled && !manageMode}
    >
      <View style={styles.rowAlbumArtWrap}>
        {item.album_art ? (
          <Image source={{ uri: item.album_art }} style={[styles.albumArtSmall, disabled && styles.disabledImage]} />
        ) : (
          <View style={[styles.albumArtPlaceholder, disabled && styles.disabledImage]}>
            <Ionicons name="musical-note" size={18} color={disabled ? "#444" : "#555"} />
          </View>
        )}
        {downloading && (
          <View style={styles.rowAlbumArtOverlay}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.songInfo}>
        <Text
          style={[
            styles.songTitle,
            active && styles.songTitleActive,
            disabled && styles.songTitleDisabled,
          ]}
          numberOfLines={1}
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
        onPress={() => onMenu(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color="#666" />
      </TouchableOpacity>
      {manageMode && (
        <View style={styles.reorderBtns}>
          <TouchableOpacity onPress={() => onMoveUp(index)} disabled={index === 0}>
            <Ionicons name="chevron-up" size={18} color={index === 0 ? "#333" : "#4ecca3"} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onMoveDown(index)} disabled={isLast}>
            <Ionicons name="chevron-down" size={18} color={isLast ? "#333" : "#4ecca3"} />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
});

export default function PlaylistView() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { user } = useUserStore();

  const queue = useMusicStore((s) => s.queue);
  const currentIndex = useMusicStore((s) => s.currentIndex);
  const loadPlaylistSongs = useMusicStore((s) => s.loadPlaylistSongs);
  const playSong = useMusicStore((s) => s.playSong);
  const playFirst = useMusicStore((s) => s.playFirst);
  const shufflePlay = useMusicStore((s) => s.shufflePlay);
  const hasActiveQueue = useMusicStore((s) => s.hasActiveQueue);
  const isInQueue = useMusicStore((s) => s.isInQueue);
  const addToQueueNext = useMusicStore((s) => s.addToQueueNext);
  const addToQueue = useMusicStore((s) => s.addToQueue);
  const removeFromQueue = useMusicStore((s) => s.removeFromQueue);

  const music = useLibraryStore((s) => s.music);
  const playlists = useLibraryStore((s) => s.playlists);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const loadMusic = useLibraryStore((s) => s.loadMusic);
  const loadPlaylists = useLibraryStore((s) => s.loadPlaylists);

  const isDownloading = useDownloadStore((s) => s.isDownloading);
  const downloadForOffline = useDownloadStore((s) => s.downloadForOffline);

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songs, setSongs] = useState<Music[]>([]);
  const [isLocal, setIsLocal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuSong, setMenuSong] = useState<Music | null>(null);
  const [manageMode, setManageMode] = useState(false);

  const listRef = useRef<FlashListRef<Music>>(null);

  const isVirtual = id === "-1" || id === "-2";
  const playlistName = name || playlist?.name || "Playlist";
  const playlistId = isVirtual ? id : playlist ? String(playlist.id) : String(id);
  const activeId = currentIndex >= 0 ? queue[currentIndex]?.id ?? null : null;
  const activeSongsIndex = songs.findIndex((s) => s.id === activeId);

  useEffect(() => {
    if (activeSongsIndex < 0) return;
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({
          index: activeSongsIndex,
          viewPosition: 0.35,
          animated: true,
        });
      } catch (e) {}
    }, 300);
    return () => clearTimeout(t);
  }, [activeSongsIndex, songs]);

  useEffect(() => {
    if (user) {
      loadMusic(user.id);
      loadPlaylists(user.id);
    }
    isLocalModeAsync().then(setIsLocal);
  }, [user]);

  useEffect(() => {
    if (isVirtual) {
      if (id === "-1") {
        setSongs(music);
      } else {
        setSongs(music.filter((m) => m.added_by === user?.id));
      }
      setPlaylist(null);
    } else {
      const p = playlists.find((pl) => pl.id === Number(id));
      if (p) {
        setPlaylist(p);
        const sorted = [...p.songs]
          .sort((a, b) => a.position - b.position)
          .map((s) => music.find((m) => m.id === s.music_id))
          .filter(Boolean) as Music[];
        setSongs(sorted);
      }
    }
  }, [id, music, playlists, isVirtual, user]);

  const playableSongs = isLocal ? songs.filter((s) => s.downloaded) : songs;
  const offlineCount = songs.filter((s) => s.downloaded).length;

  const handlePlayAll = async () => {
    if (playableSongs.length === 0) {
      if (isLocal) Alert.alert("No Songs", "No downloaded songs available to play.");
      return;
    }
    await loadPlaylistSongs(playableSongs, playlistId);
    await playFirst();
  };

  const handleShuffle = async () => {
    if (playableSongs.length === 0) {
      if (isLocal) Alert.alert("No Songs", "No downloaded songs available to play.");
      return;
    }
    await loadPlaylistSongs(playableSongs, playlistId);
    await shufflePlay();
  };

  const handleSongPress = useCallback(
    async (index: number) => {
      const song = songs[index];
      if (isLocal && !song.downloaded) return;
      await loadPlaylistSongs(playableSongs, playlistId);
      const store = useMusicStore.getState();
      const queueIndex = store.queue.findIndex((s) => s.id === song.id);
      await playSong(queueIndex >= 0 ? queueIndex : 0);
    },
    [songs, isLocal, playableSongs, playlistId, loadPlaylistSongs, playSong]
  );

  const handleDownloadAll = async () => {
    if (isLocal) return;
    await downloadForOffline(songs);
  };

  const handleDeletePlaylist = () => {
    Alert.alert("Delete Playlist", `Delete "${playlistName}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await API.delete(`/playlists/${playlist!.id}`);
            router.back();
          } catch (err: any) {
            Alert.alert("Error", err.message);
          }
        },
      },
    ]);
  };

  const handleRemoveSong = useCallback(
    async (song: Music) => {
      if (!playlist || isVirtual) return;
      try {
        await API.delete(`/playlists/${playlist.id}/remove/${song.id}`);
        setSongs((prev) => prev.filter((s) => s.id !== song.id));
        await loadPlaylists(user!.id, true);
        await loadMusic(user!.id, true);
      } catch (err: any) {
        Alert.alert("Error", err.message);
      }
    },
    [playlist, isVirtual, loadPlaylists, loadMusic, user]
  );

  const handleDownloadSong = useCallback(
    async (song: Music) => {
      if (isLocal) return;
      try {
        await downloadForOffline([song]);
      } catch (err: any) {
        Alert.alert("Error", err.message);
      }
    },
    [isLocal, downloadForOffline]
  );

  const handleSongAction = async (action: string, song: Music) => {
    switch (action) {
      case "play": {
        let store = useMusicStore.getState();
        let idx = store.queue.findIndex((s) => s.id === song.id);
        if (idx < 0) {
          await loadPlaylistSongs(playableSongs, playlistId);
          store = useMusicStore.getState();
          idx = store.queue.findIndex((s) => s.id === song.id);
        }
        if (idx >= 0) playSong(idx);
        break;
      }
      case "play_next":
        addToQueueNext(song);
        break;
      case "add_to_queue":
        addToQueue(song);
        break;
      case "remove_from_queue":
        removeFromQueue(song.id);
        break;
      case "download":
        handleDownloadSong(song);
        break;
      case "remove_playlist":
        handleRemoveSong(song);
        break;
    }
  };

  const songMenuItems = (song: Music) => {
    const hasQueue = hasActiveQueue();
    const inQueue = isInQueue(song.id);
    const items: { icon: string; label: string; onPress: () => void; destructive?: boolean }[] = [
      { icon: "play", label: "Play", onPress: () => handleSongAction("play", song) },
    ];
    if (hasQueue && !inQueue) {
      items.push(
        { icon: "play-forward", label: "Play Next", onPress: () => handleSongAction("play_next", song) },
        { icon: "add", label: "Add to Queue", onPress: () => handleSongAction("add_to_queue", song) },
      );
    }
    if (hasQueue && inQueue) {
      items.push({
        icon: "remove-circle",
        label: "Remove from Queue",
        onPress: () => handleSongAction("remove_from_queue", song),
      });
    }
    if (!isLocal && !song.downloaded) {
      items.push({
        icon: "download",
        label: "Download",
        onPress: () => handleSongAction("download", song),
      });
    }
    if (!isVirtual && playlist) {
      items.push({
        icon: "trash",
        label: "Remove from Playlist",
        onPress: () => handleSongAction("remove_playlist", song),
        destructive: true,
      });
    }
    return items;
  };

  const persistOrder = useCallback(
    async (orderedSongs: Music[]) => {
      if (!playlist || isVirtual) return;
      const updatedSongs = orderedSongs.map((s, i) => ({
        music_id: s.id,
        position: i,
      }));
      try {
        await API.put(`/playlists/${playlist.id}`, { songs: updatedSongs });
      } catch {}
    },
    [playlist, isVirtual],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0) return;
      const reordered = [...songs];
      [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
      setSongs(reordered);
      persistOrder(reordered);
    },
    [songs, persistOrder]
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= songs.length - 1) return;
      const reordered = [...songs];
      [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
      setSongs(reordered);
      persistOrder(reordered);
    },
    [songs, persistOrder]
  );

  const toggleManageMode = () => {
    setManageMode((prev) => !prev);
  };

  const renderSong = useCallback(
    ({ item, index }: { item: Music; index: number }) => (
      <SongRow
        item={item}
        index={index}
        isLocal={isLocal}
        manageMode={manageMode}
        activeId={activeId}
        isLast={index === songs.length - 1}
        onSongPress={handleSongPress}
        onLongPress={setMenuSong}
        onMenu={setMenuSong}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
      />
    ),
    [isLocal, manageMode, activeId, songs.length, handleSongPress, handleRemoveSong, handleDownloadSong, handleMoveUp, handleMoveDown]
  );

  const menuItems = [
    { icon: "play", label: "Play", onPress: handlePlayAll },
    { icon: "shuffle", label: "Shuffle Play", onPress: handleShuffle },
    ...(!isLocal ? [{ icon: "download", label: "Download All", onPress: handleDownloadAll }] : []),
    ...(!isVirtual ? [{ icon: "trash", label: "Delete Playlist", onPress: handleDeletePlaylist, destructive: true }] : []),
    { icon: manageMode ? "checkmark-circle" : "reorder-three", label: manageMode ? "Done" : "Manage", onPress: toggleManageMode },
  ];

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {songs.length > 0 && (
        <View style={styles.header}>
          <View style={styles.albumArtWrap}>
            {songs[0]?.album_art ? (
              <Image source={{ uri: songs[0].album_art }} style={styles.albumArt} />
            ) : (
              <View style={styles.albumArtPlaceholderLarge}>
                <Ionicons name="musical-notes" size={48} color="#444" />
              </View>
            )}
            {isDownloading && (
              <View style={styles.albumArtOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{playlistName}</Text>
            <Text style={styles.headerCount}>
              {songs.length} songs{offlineCount > 0 ? ` · ${offlineCount} offline` : ""}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlBtn} onPress={handlePlayAll}>
          <Ionicons name="play" size={20} color="#fff" />
          <Text style={styles.controlText}>Play</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, styles.shuffleBtn]}
          onPress={handleShuffle}
        >
          <Ionicons name="shuffle" size={20} color="#fff" />
          <Text style={styles.controlText}>Shuffle</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.controlBtn, styles.menuBtn]}
          onPress={() => setShowMenu(true)}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {manageMode && (
        <View style={styles.manageBar}>
          <Ionicons name="reorder-three" size={16} color="#4ecca3" />
          <Text style={styles.manageText}>Use the song menu to remove/download. Use arrows to reorder.</Text>
        </View>
      )}

      <FlashList
        ref={listRef}
        data={songs}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderSong}
        contentContainerStyle={{ paddingBottom: 140 }}
      />

      <Modal visible={showMenu} transparent animationType="slide" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{playlistName}</Text>
            {menuItems.map((item, i) => (
              <TouchableOpacity
                key={i}
                style={styles.sheetItem}
                onPress={() => {
                  setShowMenu(false);
                  item.onPress();
                }}
              >
                <Ionicons
                  name={item.icon as any}
                  size={22}
                  color={item.destructive ? "#e94560" : "#fff"}
                />
                <Text style={[styles.sheetLabel, item.destructive && { color: "#e94560" }]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!menuSong} transparent animationType="slide" onRequestClose={() => setMenuSong(null)}>
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
                  <Ionicons
                    name={item.icon as any}
                    size={22}
                    color={item.destructive ? "#e94560" : "#fff"}
                  />
                  <Text style={[styles.sheetLabel, item.destructive && { color: "#e94560" }]}>
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
    padding: 16,
    alignItems: "center",
    gap: 16,
  },
  albumArt: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  albumArtWrap: {
    width: 80,
    height: 80,
  },
  albumArtOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  albumArtPlaceholderLarge: {
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
    backgroundColor: "#e94560",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  shuffleBtn: { backgroundColor: "#0f3460" },
  menuBtn: { backgroundColor: "#16213e", paddingHorizontal: 14 },
  controlText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  manageBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  manageText: { color: "#4ecca3", fontSize: 12 },
  songItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  songItemActive: { backgroundColor: "rgba(233,69,96,0.1)" },
  songItemDisabled: { opacity: 0.45 },
  disabledImage: { opacity: 0.45 },
  songTitleDisabled: { color: "#555" },
  albumArtSmall: { width: 36, height: 36, borderRadius: 6 },
  albumArtPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#16213e",
    justifyContent: "center",
    alignItems: "center",
  },
  rowAlbumArtWrap: {
    width: 36,
    height: 36,
  },
  rowAlbumArtOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  songInfo: { flex: 1 },
  rowMenuBtn: {
    padding: 6,
  },
  songTitle: { color: "#fff", fontSize: 14, fontWeight: "500" },
  songTitleActive: { color: "#e94560" },
  songArtist: { color: "#888", fontSize: 12, marginTop: 2 },
  reorderBtns: {
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
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
});
