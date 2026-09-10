import { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Image,
  Modal,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { API, isLocalModeAsync } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useMusicStore } from "@/stores/musicStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useDownloadStore } from "@/stores/downloadStore";
import { AddToPlaylistSheet } from "@/components";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Music, Playlist } from "@/types";

export default function MusicHome() {
  const { user } = useUserStore();
  const playlists = useLibraryStore((s) => s.playlists);
  const music = useLibraryStore((s) => s.music);
  const isLoading = useLibraryStore((s) => s.isLoading);
  const loadPlaylists = useLibraryStore((s) => s.loadPlaylists);
  const loadMusic = useLibraryStore((s) => s.loadMusic);
  const showVirtualPlaylists = useSettingsStore((s) => s.showVirtualPlaylists);
  const loadSettings = useSettingsStore((s) => s.load);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [isLocal, setIsLocal] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const loadPlaylistSongs = useMusicStore((s) => s.loadPlaylistSongs);
  const playSong = useMusicStore((s) => s.playSong);
  const playNow = useMusicStore((s) => s.playNow);
  const addToQueue = useMusicStore((s) => s.addToQueue);
  const addToQueueNext = useMusicStore((s) => s.addToQueueNext);
  const downloadForOffline = useDownloadStore((s) => s.downloadForOffline);

  const [menuSong, setMenuSong] = useState<Music | null>(null);
  const [playlistPickerSong, setPlaylistPickerSong] = useState<Music | null>(
    null
  );

  useEffect(() => {
    loadSettings();
    isLocalModeAsync().then(setIsLocal);
    if (user) {
      loadPlaylists(user.id);
      loadMusic(user.id);
    }
  }, [user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user) {
      await loadPlaylists(user.id, true);
      await loadMusic(user.id, true);
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

  const visibleVirtualPlaylists = showVirtualPlaylists
    ? virtualPlaylists
    : [];

  const songMatches = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return null;
    const set = new Set<number>();
    for (const m of music) {
      if (
        (m.title || "").toLowerCase().includes(q) ||
        (m.artist || "").toLowerCase().includes(q) ||
        (m.filename || "").toLowerCase().includes(q)
      ) {
        set.add(m.id);
      }
    }
    return set;
  }, [debouncedQuery, music]);

  const searching = focused || query.trim().length > 0;

  const matchedSongs = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return [];
    const set = songMatches!;
    const out: Music[] = [];
    const seen = new Set<number>();
    for (const m of music) {
      if (set.has(m.id) && !seen.has(m.id)) {
        seen.add(m.id);
        out.push(m);
      }
    }
    return out;
  }, [debouncedQuery, music, songMatches]);

  const filteredPlaylists = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return playlists;
    const set = songMatches!;
    return playlists.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.songs || []).some((sp) => set.has(sp.music_id))
    );
  }, [debouncedQuery, playlists, songMatches]);

  const filteredVirtualPlaylists = useMemo(() => {
    const q = debouncedQuery.toLowerCase();
    if (!q) return visibleVirtualPlaylists;
    const set = songMatches!;
    return visibleVirtualPlaylists
      .map((vp) => {
        const songs = (vp.songs || []).filter((sp) => set.has(sp.music_id));
        const nameMatch = (vp.name || "").toLowerCase().includes(q);
        return { ...vp, songs, _nameMatched: nameMatch };
      })
      .filter((vp) => vp._nameMatched || vp.songs.length > 0);
  }, [debouncedQuery, visibleVirtualPlaylists, songMatches]);

  const allPlaylists = [...filteredVirtualPlaylists, ...filteredPlaylists];

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

  const exitSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setFocused(false);
  }, []);

  const playResults = useCallback(
    async (index: number) => {
      const songs = matchedSongs;
      if (songs.length === 0) return;
      const song = songs[index];
      if (isLocal && !song.downloaded) return;
      const wasEmpty = useMusicStore.getState().queue.length === 0;
      await loadPlaylistSongs(songs, null);
      const store = useMusicStore.getState();
      const qi = store.queue.findIndex((s) => s.id === song.id);
      await playSong(qi >= 0 ? qi : 0);
      if (wasEmpty) router.navigate("/(tabs)/music/playing" as any);
    },
    [matchedSongs, isLocal, loadPlaylistSongs, playSong]
  );

  const renderResultSong = useCallback(
    ({ item, index }: { item: Music; index: number }) => {
      const disabled = isLocal && !item.downloaded;
      return (
        <TouchableOpacity
          style={[styles.songItem, disabled && styles.songItemDisabled]}
          onPress={() => playResults(index)}
          disabled={disabled}
        >
          {item.album_art ? (
            <Image source={{ uri: item.album_art }} style={styles.albumArtSmall} />
          ) : (
            <View style={styles.albumArtPlaceholder}>
              <Ionicons name="musical-note" size={18} color="#555" />
            </View>
          )}
          <View style={styles.songInfo}>
            <Text style={styles.songTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.songArtist} numberOfLines={1}>
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
    },
    [isLocal, playResults]
  );

  const menuForSong = useCallback(
    (song: Music) => {
      const disabled = isLocal && !song.downloaded;
      const items: {
        icon: string;
        label: string;
        onPress: () => void;
        disabled?: boolean;
      }[] = [
        {
          icon: "play",
          label: "Play",
          onPress: () => {
            if (!disabled) playNow(song);
          },
          disabled,
        },
        {
          icon: "play-forward",
          label: "Play Next",
          onPress: () => {
            if (!disabled) addToQueueNext(song);
          },
          disabled,
        },
        {
          icon: "add",
          label: "Add to Queue",
          onPress: () => {
            if (!disabled) addToQueue(song);
          },
          disabled,
        },
        {
          icon: "list",
          label: "Add to Playlist",
          onPress: () => {
            setMenuSong(null);
            setPlaylistPickerSong(song);
          },
        },
      ];
      if (!isLocal && !song.downloaded) {
        items.push({
          icon: "download",
          label: "Download",
          onPress: () => downloadForOffline([song]),
        });
      }
      return items;
    },
    [isLocal, playNow, addToQueueNext, addToQueue, downloadForOffline]
  );

  const renderPlaylist = useCallback(
    ({ item }: { item: Playlist & { _virtual?: boolean } }) => {
      const total = item.songs?.length || 0;
      const songIds = new Set(item.songs?.map((s) => s.music_id) ?? []);
      const offline = music.filter((m) => songIds.has(m.id) && m.downloaded).length;
      const allOffline = total > 0 && offline === total;
      return (
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
            <View style={styles.playlistTitleRow}>
              <Text style={styles.playlistName}>{item.name}</Text>
              {allOffline && (
                <Ionicons name="checkmark-circle" size={14} color="#4ecca3" />
              )}
            </View>
            <Text style={[styles.songCount, allOffline && styles.songCountOffline]}>
              {total} songs{offline > 0 ? ` · ${offline} offline` : ""}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#444" />
        </TouchableOpacity>
      );
    },
    [music]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color="#666" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search playlists & songs…"
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
          <TouchableOpacity style={styles.addBtn} onPress={handleAddPress}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {searching ? (
        query.trim().length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search" size={48} color="#444" />
            <Text style={styles.emptyText}>Type to search</Text>
            <Text style={styles.emptyHint}>Search by song, artist, or playlist</Text>
          </View>
        ) : matchedSongs.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="musical-notes-outline" size={48} color="#444" />
            <Text style={styles.emptyText}>No matches</Text>
            <Text style={styles.emptyHint}>Try a different search</Text>
          </View>
        ) : (
          <FlashList
            data={matchedSongs}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderResultSong}
            ListHeaderComponent={
              <Text style={styles.resultsLabel}>
                {matchedSongs.length} result{matchedSongs.length === 1 ? "" : "s"}
              </Text>
            }
            contentContainerStyle={{ paddingBottom: 100 }}
          />
        )
      ) : isLoading && playlists.length === 0 ? (
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
      ) : allPlaylists.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="musical-notes-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>No music yet</Text>
          <Text style={styles.emptyHint}>Tap + to add music or import data</Text>
        </View>
      ) : (
        <FlashList
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

      <Modal
        visible={!!menuSong}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuSong(null)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setMenuSong(null)}
        >
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {menuSong?.title || ""}
            </Text>
            {menuSong &&
              menuForSong(menuSong).map((item, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.sheetItem, item.disabled && styles.sheetItemDisabled]}
                  onPress={() => {
                    setMenuSong(null);
                    item.onPress();
                  }}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={22}
                    color={item.disabled ? "#555" : "#fff"}
                  />
                  <Text
                    style={[
                      styles.sheetLabel,
                      item.disabled && { color: "#555" },
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <AddToPlaylistSheet
        song={playlistPickerSong}
        onClose={() => setPlaylistPickerSong(null)}
      />
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
  songItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  songItemDisabled: { opacity: 0.45 },
  albumArtSmall: { width: 36, height: 36, borderRadius: 6 },
  albumArtPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#16213e",
    justifyContent: "center",
    alignItems: "center",
  },
  songInfo: { flex: 1 },
  songTitle: { color: "#fff", fontSize: 14, fontWeight: "500" },
  songArtist: { color: "#888", fontSize: 12, marginTop: 2 },
  rowMenuBtn: { padding: 6 },
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
  sheetItemDisabled: { opacity: 0.5 },
  sheetLabel: { color: "#fff", fontSize: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: 16,
    paddingBottom: 8,
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
    flexShrink: 1,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, padding: 0 },
  heading: { color: "#fff", fontSize: 20, fontWeight: "700" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e94560",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
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
  playlistTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  playlistName: { color: "#fff", fontSize: 16, fontWeight: "500", marginBottom: 2 },
  songCount: { color: "#888", fontSize: 12 },
  songCountOffline: { color: "#4ecca3" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyText: { color: "#666", fontSize: 16, marginTop: 12 },
  emptyHint: { color: "#444", fontSize: 13, marginTop: 4 },
});
