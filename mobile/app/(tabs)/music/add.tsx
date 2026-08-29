import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { router } from "expo-router";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useMusicStore } from "@/stores/musicStore";
import { Ionicons } from "@expo/vector-icons";
import type { Playlist } from "@/types";

export default function AddMusic() {
  const { user } = useUserStore();
  const { playlists, loadPlaylists } = useMusicStore();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | null>(null);
  const [createNewPlaylist, setCreateNewPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");

  useEffect(() => {
    if (user) loadPlaylists(user.id);
  }, [user]);

  const handleAdd = async () => {
    if (!url.trim() || !user) return;
    setLoading(true);
    try {
      let playlistId = selectedPlaylist;
      if (createNewPlaylist && newPlaylistName.trim()) {
        const newPlaylist = await API.post("/playlists", {
          name: newPlaylistName.trim(),
          user_id: user.id,
        });
        playlistId = newPlaylist.id;
      }

      await API.post("/music/add", {
        url: url.trim(),
        user_id: user.id,
        playlist_id: playlistId || undefined,
      });

      Alert.alert("Added", "Music has been added", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.form}>
        <Text style={styles.label}>Music URL</Text>
        <TextInput
          style={styles.input}
          placeholder="https://www.youtube.com/watch?v=..."
          placeholderTextColor="#666"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Add to Playlist</Text>
        <FlatList
          data={playlists}
          keyExtractor={(item) => String(item.id)}
          style={styles.playlistList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.playlistItem,
                selectedPlaylist === item.id && styles.playlistItemActive,
              ]}
              onPress={() => {
                setSelectedPlaylist(item.id);
                setCreateNewPlaylist(false);
              }}
            >
              <Text style={styles.playlistItemText}>{item.name}</Text>
              {selectedPlaylist === item.id && (
                <Ionicons name="checkmark-circle" size={20} color="#e94560" />
              )}
            </TouchableOpacity>
          )}
        />

        <TouchableOpacity
          style={[styles.checkRow, createNewPlaylist && styles.checkRowActive]}
          onPress={() => {
            setCreateNewPlaylist(!createNewPlaylist);
            setSelectedPlaylist(null);
          }}
        >
          <Ionicons
            name={createNewPlaylist ? "checkbox" : "square-outline"}
            size={20}
            color={createNewPlaylist ? "#e94560" : "#666"}
          />
          <Text style={styles.checkLabel}>Create new playlist</Text>
        </TouchableOpacity>

        {createNewPlaylist && (
          <TextInput
            style={styles.input}
            placeholder="Playlist name"
            placeholderTextColor="#666"
            value={newPlaylistName}
            onChangeText={setNewPlaylistName}
          />
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.disabled]}
          onPress={handleAdd}
          disabled={loading || !url.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.buttonText}>Add Music</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  form: { padding: 16, gap: 12, paddingBottom: 80 },
  label: { color: "#fff", fontSize: 14, fontWeight: "600" },
  input: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    color: "#fff",
  },
  playlistList: { maxHeight: 200 },
  playlistItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
  },
  playlistItemActive: { borderColor: "#e94560", borderWidth: 1 },
  playlistItemText: { color: "#fff", fontSize: 14 },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
  },
  checkRowActive: {},
  checkLabel: { color: "#ccc", fontSize: 14 },
  button: {
    backgroundColor: "#e94560",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
