import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useLibraryStore } from "@/stores/libraryStore";
import type { Music, Playlist } from "@/types";

interface Props {
  song: Music | null;
  onClose: () => void;
}

export function AddToPlaylistSheet({ song, onClose }: Props) {
  const { user } = useUserStore();
  const playlists = useLibraryStore((s) => s.playlists);
  const loadPlaylists = useLibraryStore((s) => s.loadPlaylists);
  const addToPlaylist = useLibraryStore((s) => s.addToPlaylist);

  const [createMode, setCreateMode] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setCreateMode(false);
    setName("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePick = (playlistId: number) => {
    if (!song) return;
    handleClose();
    addToPlaylist(playlistId, song);
  };

  const handleCreate = async () => {
    if (!song || !user || !name.trim()) return;
    setCreating(true);
    try {
      const created = (await API.post("/playlists", {
        name: name.trim(),
        user_id: user.id,
        kind: "music",
      })) as Playlist;
      await loadPlaylists(user.id, true);
      handleClose();
      addToPlaylist(created.id, song);
    } catch {}
    setCreating(false);
  };

  const realPlaylists = playlists.filter((p) => p.id > 0);

  return (
    <Modal
      visible={!!song}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={handleClose}
      >
        <View style={styles.bottomSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle} numberOfLines={1}>
            Add to Playlist
          </Text>
          {song && (
            <Text style={styles.songName} numberOfLines={1}>
              {song.title || song.url}
            </Text>
          )}

          {createMode ? (
            <View>
              <TextInput
                style={styles.createInput}
                placeholder="Playlist name"
                placeholderTextColor="#666"
                value={name}
                onChangeText={setName}
                autoFocus
                maxLength={100}
              />
              <View style={styles.createActions}>
                <TouchableOpacity
                  style={[styles.createBtn, styles.createCancelBtn]}
                  onPress={() => setCreateMode(false)}
                >
                  <Text style={styles.createCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.createBtn,
                    styles.createSaveBtn,
                    (!name.trim() || creating) && styles.createBtnDisabled,
                  ]}
                  onPress={handleCreate}
                  disabled={!name.trim() || creating}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.createSaveText}>Create & Add</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.sheetItem}
                onPress={() => setCreateMode(true)}
              >
                <Ionicons name="add-circle" size={22} color="#4ecca3" />
                <Text style={[styles.sheetLabel, { color: "#4ecca3" }]}>
                  Create New Playlist
                </Text>
              </TouchableOpacity>
              {realPlaylists.length === 0 ? (
                <Text style={styles.emptyHint}>
                  No playlists yet — create one above.
                </Text>
              ) : (
                <ScrollView style={styles.list}>
                  {realPlaylists.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.sheetItem}
                      onPress={() => handlePick(p.id)}
                    >
                      <Ionicons name="folder" size={20} color="#e94560" />
                      <Text style={styles.sheetLabel}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  },
  songName: {
    color: "#888",
    fontSize: 14,
    marginTop: 4,
    marginBottom: 8,
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
  },
  sheetLabel: { color: "#fff", fontSize: 16 },
  list: { maxHeight: 360 },
  emptyHint: {
    color: "#555",
    fontSize: 13,
    marginTop: 8,
  },
  createInput: {
    backgroundColor: "#0f3460",
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    color: "#fff",
    marginTop: 12,
    marginBottom: 16,
  },
  createActions: {
    flexDirection: "row",
    gap: 12,
  },
  createBtn: {
    flex: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  createCancelBtn: { backgroundColor: "#0f3460" },
  createCancelText: { color: "#888", fontSize: 16, fontWeight: "600" },
  createSaveBtn: { backgroundColor: "#e94560" },
  createSaveText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  createBtnDisabled: { opacity: 0.6 },
});