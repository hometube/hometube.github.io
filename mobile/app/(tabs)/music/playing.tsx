import { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Modal,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Ionicons } from "@expo/vector-icons";
import { isLocalModeAsync } from "@/api";
import { useMusicStore } from "@/stores/musicStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useDownloadStore } from "@/stores/downloadStore";
import { EmptyState } from "@/components";
import type { Music } from "@/types";

interface PlayingRowProps {
  item: Music;
  index: number;
  active: boolean;
  onSongPress: (index: number) => void;
  onMenu: (item: Music) => void;
}

function PlayingRow({
  item,
  index,
  active,
  onSongPress,
  onMenu,
}: PlayingRowProps) {
  return (
    <TouchableOpacity
      style={[styles.songItem, active && styles.songItemActive]}
      onPress={() => onSongPress(index)}
    >
      <View style={styles.rowAlbumArtWrap}>
        {item.album_art ? (
          <Image source={{ uri: item.album_art }} style={styles.albumArtSmall} />
        ) : (
          <View style={styles.albumArtPlaceholder}>
            <Ionicons name="musical-note" size={18} color="#555" />
          </View>
        )}
      </View>
      <View style={styles.songInfo}>
        <Text
          style={[styles.songTitle, active && styles.songTitleActive]}
          numberOfLines={1}
        >
          {item.title}
        </Text>
        <Text style={styles.songArtist} numberOfLines={1}>
          {item.artist || "Unknown"}
        </Text>
      </View>
      {item.downloaded && (
        <Ionicons name="checkmark-circle" size={16} color="#4ecca3" />
      )}
      {active && <Ionicons name="volume-high" size={18} color="#e94560" />}
      <TouchableOpacity
        style={styles.rowMenuBtn}
        onPress={() => onMenu(item)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color="#666" />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function PlayingView() {
  const queue = useMusicStore((s) => s.queue);
  const currentIndex = useMusicStore((s) => s.currentIndex);
  const repeat = useMusicStore((s) => s.repeat);
  const playSong = useMusicStore((s) => s.playSong);
  const toggleRepeat = useMusicStore((s) => s.toggleRepeat);
  const removeFromQueue = useMusicStore((s) => s.removeFromQueue);
  const music = useLibraryStore((s) => s.music);
  const downloadForOffline = useDownloadStore((s) => s.downloadForOffline);

  const [isLocal, setIsLocal] = useState(false);
  const [menuSong, setMenuSong] = useState<Music | null>(null);

  useEffect(() => {
    isLocalModeAsync().then(setIsLocal);
  }, []);

  const libraryMap = useMemo(
    () => new Map(music.map((m) => [m.id, m])),
    [music]
  );

  const handleSongPress = useCallback(
    async (index: number) => {
      await playSong(index);
    },
    [playSong]
  );

  const renderSong = useCallback(
    ({ item, index }: { item: Music; index: number }) => {
      const lib = libraryMap.get(item.id);
      const rowItem = lib
        ? { ...item, album_art: lib.album_art, downloaded: lib.downloaded }
        : item;
      return (
        <PlayingRow
          item={rowItem}
          index={index}
          active={index === currentIndex}
          onSongPress={handleSongPress}
          onMenu={setMenuSong}
        />
      );
    },
    [currentIndex, libraryMap, handleSongPress]
  );

  const menuForSong = useCallback(
    (song: Music) => {
      const items: {
        icon: string;
        label: string;
        onPress: () => void;
        destructive?: boolean;
      }[] = [
        {
          icon: "remove-circle",
          label: "Remove from Queue",
          onPress: () => removeFromQueue(song.id),
          destructive: true,
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
    [isLocal, removeFromQueue, downloadForOffline]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Playing</Text>
        <TouchableOpacity
          style={[styles.repeatBtn, repeat && styles.repeatBtnActive]}
          onPress={toggleRepeat}
        >
          <Ionicons
            name={repeat ? "repeat" : "repeat-outline"}
            size={20}
            color={repeat ? "#e94560" : "#888"}
          />
          <Text style={[styles.repeatText, repeat && styles.repeatTextActive]}>
            {repeat ? "Repeat On" : "Repeat Off"}
          </Text>
        </TouchableOpacity>
      </View>

      {queue.length === 0 ? (
        <EmptyState
          icon="musical-notes-outline"
          title="Nothing playing"
          message="Add songs from a playlist to build a queue."
        />
      ) : (
        <FlashList
          data={queue}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderSong}
          contentContainerStyle={{ paddingBottom: 140 }}
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
                  <Text
                    style={[
                      styles.sheetLabel,
                      item.destructive && { color: "#e94560" },
                    ]}
                  >
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
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingBottom: 8,
  },
  heading: { color: "#fff", fontSize: 20, fontWeight: "700" },
  repeatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#16213e",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  repeatBtnActive: { backgroundColor: "rgba(233,69,96,0.15)" },
  repeatText: { color: "#888", fontSize: 13, fontWeight: "600" },
  repeatTextActive: { color: "#e94560" },
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
  rowAlbumArtWrap: {
    width: 36,
    height: 36,
  },
  songInfo: { flex: 1 },
  rowMenuBtn: {
    padding: 6,
  },
  songTitle: { color: "#fff", fontSize: 14, fontWeight: "500" },
  songTitleActive: { color: "#e94560" },
  songArtist: { color: "#888", fontSize: 12, marginTop: 2 },
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