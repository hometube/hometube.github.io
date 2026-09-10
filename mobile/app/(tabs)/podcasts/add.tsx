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
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { API, isLocalModeAsync } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { usePodcastStore } from "@/stores/podcastStore";
import Ionicons from "@expo/vector-icons/Ionicons";

type Tab = "subscribe" | "episode";

export default function AddPodcast() {
  const { user } = useUserStore();
  const playlists = usePodcastStore((s) => s.playlists);
  const load = usePodcastStore((s) => s.load);
  const createPlaylist = usePodcastStore((s) => s.createPlaylist);

  const [tab, setTab] = useState<Tab>("subscribe");
  const [url, setUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [minLength, setMinLength] = useState("");
  const [maxLength, setMaxLength] = useState("");
  const [interval, setInterval] = useState("60");
  const [selectedPlaylist, setSelectedPlaylist] = useState<number | null>(null);
  const [createNewPlaylist, setCreateNewPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [loading, setLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);

  useEffect(() => {
    isLocalModeAsync().then(setIsLocal);
  }, []);

  useEffect(() => {
    if (user) load(user.id);
  }, [user]);

  const resolvePlaylist = async (): Promise<number | undefined> => {
    if (!user) return undefined;
    if (createNewPlaylist && newPlaylistName.trim()) {
      const playlist = await createPlaylist(newPlaylistName.trim(), user.id);
      return playlist.id;
    }
    return selectedPlaylist ?? undefined;
  };

  const handleSubscribe = async () => {
    if (!url.trim() || !user) return;
    setLoading(true);
    setInfoMessage(null);
    try {
      const keywordsList = keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      const check_interval = parseInt(interval, 10);
      await API.post("/podcasts/subscribe", {
        url: url.trim(),
        user_id: user.id,
        criteria: {
          keywords: keywordsList.length > 0 ? keywordsList : undefined,
          min_length: minLength ? Math.floor(parseInt(minLength, 10) * 60) : undefined,
          max_length: maxLength ? Math.floor(parseInt(maxLength, 10) * 60) : undefined,
        },
        check_interval: !isNaN(check_interval) && check_interval > 0 ? check_interval : 60,
      });
      await load(user.id, true);
      setInfoMessage(
        "Subscription created. Recent uploads were added as episodes (audio only). Unplayed videos were also sourced."
      );
      setUrl("");
      setKeywords("");
      setMinLength("");
      setMaxLength("");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEpisode = async () => {
    if (!url.trim() || !user) return;
    setLoading(true);
    setInfoMessage(null);
    try {
      const playlistId = await resolvePlaylist();
      await API.post("/music/add", {
        url: url.trim(),
        user_id: user.id,
        playlist_id: playlistId,
        kind: "podcast",
      });
      await load(user.id, true);
      setInfoMessage("Episode added. It will download when you play it.");
      setUrl("");
      setNewPlaylistName("");
      setCreateNewPlaylist(false);
      setSelectedPlaylist(null);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderPlaylistPicker = (isEpisodeTab: boolean) => (
    <>
      <Text style={styles.label}>Add to Playlist</Text>
      {playlists.length > 0 ? (
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
                <Ionicons name="checkmark-circle" size={20} color="#9070e9" />
              )}
            </TouchableOpacity>
          )}
        />
      ) : (
        <Text style={styles.noPlaylists}>No podcast playlists yet</Text>
      )}

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
          color={createNewPlaylist ? "#9070e9" : "#666"}
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
      {isEpisodeTab && (
        <Text style={styles.hint}>
          Note: this only matters if you want the episode to appear in a
          podcast playlist immediately.
        </Text>
      )}
    </>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === "subscribe" && styles.tabActive]}
          onPress={() => setTab("subscribe")}
        >
          <Ionicons
            name="radio"
            size={16}
            color={tab === "subscribe" ? "#0f3460" : "#888"}
          />
          <Text style={[styles.tabText, tab === "subscribe" && styles.tabTextActive]}>
            Subscribe
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "episode" && styles.tabActive]}
          onPress={() => setTab("episode")}
        >
          <Ionicons
            name="musical-note"
            size={16}
            color={tab === "episode" ? "#0f3460" : "#888"}
          />
          <Text style={[styles.tabText, tab === "episode" && styles.tabTextActive]}>
            Add Episode
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={[]}
        keyExtractor={() => "x"}
        renderItem={null}
        ListHeaderComponent={
          <View style={styles.form}>
            {isLocal && (
              <View style={styles.localBanner}>
                <Ionicons name="cloud-offline" size={16} color="#e94560" />
                <Text style={styles.localBannerText}>
                  Local mode — subscribing and adding episodes require server
                  mode. Switch modes in Settings.
                </Text>
              </View>
            )}

            <Text style={styles.label}>Podcast URL</Text>
            <Text style={styles.urlHint}>
              Channel, video, playlist, bandcamp, soundcloud, or any supported link
            </Text>
            <TextInput
              style={styles.input}
              placeholder="https://www.youtube.com/..."
              placeholderTextColor="#666"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {tab === "subscribe" ? (
              <>
                <Text style={styles.label}>Filter Criteria</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Keywords (comma separated)"
                  placeholderTextColor="#666"
                  value={keywords}
                  onChangeText={setKeywords}
                />
                <View style={styles.row}>
                  <View style={styles.rowField}>
                    <Text style={styles.fieldLabel}>Min length (min)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 10"
                      placeholderTextColor="#666"
                      value={minLength}
                      onChangeText={setMinLength}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.rowField}>
                    <Text style={styles.fieldLabel}>Max length (min)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 120"
                      placeholderTextColor="#666"
                      value={maxLength}
                      onChangeText={setMaxLength}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                <Text style={styles.label}>Check Interval (minutes)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="60"
                  placeholderTextColor="#666"
                  value={interval}
                  onChangeText={setInterval}
                  keyboardType="numeric"
                />
                {renderPlaylistPicker(false)}
                <TouchableOpacity
                  style={[styles.button, (loading || isLocal) && styles.disabled]}
                  onPress={handleSubscribe}
                  disabled={loading || isLocal || !url.trim()}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.buttonText}>Subscribe</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                {renderPlaylistPicker(true)}
                <TouchableOpacity
                  style={[styles.button, (loading || isLocal) && styles.disabled]}
                  onPress={handleAddEpisode}
                  disabled={loading || isLocal || !url.trim()}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.buttonText}>Add Episode</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {infoMessage && (
              <View style={styles.infoBox}>
                <Ionicons name="checkmark-circle" size={18} color="#4ecca3" />
                <Text style={styles.infoText}>{infoMessage}</Text>
              </View>
            )}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 80 }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  tabs: {
    flexDirection: "row",
    gap: 8,
    padding: 16,
    paddingBottom: 4,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#16213e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabActive: { backgroundColor: "#9070e9" },
  tabText: { color: "#888", fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: "#0f3460" },
  form: { padding: 16, gap: 12 },
  label: { color: "#fff", fontSize: 14, fontWeight: "600" },
  urlHint: { color: "#666", fontSize: 12, marginTop: -8 },
  input: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    color: "#fff",
  },
  row: { flexDirection: "row", gap: 12 },
  rowField: { flex: 1 },
  fieldLabel: { color: "#888", fontSize: 12, marginBottom: 6 },
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
  playlistItemActive: { borderColor: "#9070e9", borderWidth: 1 },
  playlistItemText: { color: "#fff", fontSize: 14 },
  noPlaylists: { color: "#666", fontSize: 13, paddingVertical: 8 },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
  },
  checkRowActive: {},
  checkLabel: { color: "#ccc", fontSize: 14 },
  hint: { color: "#555", fontSize: 12 },
  localBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(233,69,96,0.12)",
    borderRadius: 8,
    padding: 12,
  },
  localBannerText: { color: "#e94560", fontSize: 12, flex: 1 },
  button: {
    backgroundColor: "#9070e9",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(78,204,163,0.1)",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  infoText: { color: "#4ecca3", fontSize: 13, flex: 1 },
});