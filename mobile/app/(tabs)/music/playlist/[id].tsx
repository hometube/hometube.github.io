import { useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useMusicStore } from "@/stores/musicStore";
import { Ionicons } from "@expo/vector-icons";
import type { Music, Playlist } from "@/types";

export default function PlaylistView() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const { user } = useUserStore();
  const { music, playlists, loadMusic, loadPlaylists, playPlaylist, playAll, isLoading } =
    useMusicStore();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songs, setSongs] = useState<Music[]>([]);
  const [currentSong, setCurrentSong] = useState<Music | null>(null);

  const isVirtual = id === "-1" || id === "-2";
  const playlistName = name || playlist?.name || "Playlist";

  useEffect(() => {
    if (user) {
      loadMusic(user.id);
      loadPlaylists(user.id);
    }
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
        const songIds = new Set(p.songs.map((s) => s.music_id));
        const sorted = p.songs
          .sort((a, b) => a.position - b.position)
          .map((s) => music.find((m) => m.id === s.music_id))
          .filter(Boolean) as Music[];
        setSongs(sorted);
      }
    }
  }, [id, music, playlists, isVirtual, user]);

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    if (playlist) {
      playPlaylist(playlist, songs);
    } else {
      playAll(songs);
    }
    router.push("/(tabs)/music/now-playing");
  };

  const handleShuffle = () => {
    if (songs.length === 0) return;
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    if (playlist) {
      const virtualPlaylist = { ...playlist, songs: shuffled.map((s, i) => ({ music_id: s.id, position: i })) };
      playPlaylist(virtualPlaylist, shuffled);
    } else {
      playAll(shuffled);
    }
    router.push("/(tabs)/music/now-playing");
  };

  const handleSongPress = (index: number) => {
    if (playlist) {
      playPlaylist(playlist, songs, index);
    } else {
      playAll(songs, index);
    }
    setCurrentSong(songs[index]);
    router.push("/(tabs)/music/now-playing");
  };

  const renderSong = ({ item, index }: { item: Music; index: number }) => (
    <TouchableOpacity
      style={[
        styles.songItem,
        currentSong?.id === item.id && styles.songItemActive,
      ]}
      onPress={() => handleSongPress(index)}
    >
      {item.album_art ? (
        <Image source={{ uri: item.album_art }} style={styles.albumArtSmall} />
      ) : (
        <View style={styles.albumArtPlaceholder}>
          <Ionicons name="musical-note" size={18} color="#555" />
        </View>
      )}
      <View style={styles.songInfo}>
        <Text
          style={[
            styles.songTitle,
            currentSong?.id === item.id && styles.songTitleActive,
          ]}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        <Text style={styles.songArtist} numberOfLines={1}>
          {item.artist || "Unknown"}
        </Text>
      </View>
      {item.downloaded && (
        <Ionicons name="download" size={14} color="#4ecca3" />
      )}
    </TouchableOpacity>
  );

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
          {songs[0]?.album_art ? (
            <Image source={{ uri: songs[0].album_art }} style={styles.albumArt} />
          ) : (
            <View style={styles.albumArtPlaceholderLarge}>
              <Ionicons name="musical-notes" size={48} color="#444" />
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{playlistName}</Text>
            <Text style={styles.headerCount}>{songs.length} songs</Text>
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
      </View>

      <FlatList
        data={songs}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderSong}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
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
  controlText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  songItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  songItemActive: { backgroundColor: "rgba(233,69,96,0.1)" },
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
  songTitleActive: { color: "#e94560" },
  songArtist: { color: "#888", fontSize: 12, marginTop: 2 },
});
