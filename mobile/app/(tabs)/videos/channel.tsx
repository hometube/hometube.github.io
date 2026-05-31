import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useVideoStore } from "@/stores/videoStore";
import { Ionicons } from "@expo/vector-icons";

interface ChannelResult {
  id: number;
  title: string;
  url: string;
  thumbnail?: string;
  subscribers?: number;
}

interface ChannelVideo {
  id: string;
  title: string;
  url: string;
  duration?: number;
}

export default function AddChannel() {
  const { user } = useUserStore();
  const { addChannel, subscribe, channels, loadChannels } = useVideoStore();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [channelInfo, setChannelInfo] = useState<ChannelResult | null>(null);
  const [videos, setVideos] = useState<ChannelVideo[]>([]);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [keywords, setKeywords] = useState("");
  const [minLength, setMinLength] = useState("");
  const [maxLength, setMaxLength] = useState("");

  useEffect(() => {
    loadChannels();
  }, []);

  const handleSearch = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const result = await API.post("/channels/add", {
        url: url.trim(),
        user_id: user?.id,
      });
      setChannelInfo(result);
      setShowSubscribe(false);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBrowse = async () => {
    if (!channelInfo) return;
    setLoading(true);
    try {
      const result = await API.get(`/channels/${channelInfo.id}/videos`);
      setVideos(result.videos || result || []);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (!channelInfo || !user) return;
    setLoading(true);
    try {
      const criteria: any = {};
      if (keywords.trim()) criteria.keywords = keywords.split(",").map((k) => k.trim());
      if (minLength) criteria.min_length = parseInt(minLength);
      if (maxLength) criteria.max_length = parseInt(maxLength);

      await subscribe(channelInfo.id, user.id, criteria);
      Alert.alert("Subscribed", `Subscribed to ${channelInfo.title}`);
      router.back();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Channel URL"
          placeholderTextColor="#666"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={styles.searchBtn}
          onPress={handleSearch}
          disabled={loading}
        >
          <Ionicons name="search" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 20 }} />}

      {channelInfo && !loading && (
        <View style={styles.channelCard}>
          <Text style={styles.channelTitle}>{channelInfo.title}</Text>
          <View style={styles.channelActions}>
            <TouchableOpacity style={styles.actionBtn} onPress={handleBrowse}>
              <Ionicons name="list" size={18} color="#fff" />
              <Text style={styles.actionText}>Browse Videos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.subscribeBtn]}
              onPress={() => setShowSubscribe(!showSubscribe)}
            >
              <Ionicons name="notifications" size={18} color="#fff" />
              <Text style={styles.actionText}>Subscribe</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {showSubscribe && (
        <View style={styles.subscribeForm}>
          <Text style={styles.sectionTitle}>Subscription Criteria</Text>
          <TextInput
            style={styles.input}
            placeholder="Keywords (comma separated)"
            placeholderTextColor="#666"
            value={keywords}
            onChangeText={setKeywords}
          />
          <View style={styles.lengthRow}>
            <TextInput
              style={[styles.input, styles.lengthInput]}
              placeholder="Min (s)"
              placeholderTextColor="#666"
              value={minLength}
              onChangeText={setMinLength}
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.input, styles.lengthInput]}
              placeholder="Max (s)"
              placeholderTextColor="#666"
              value={maxLength}
              onChangeText={setMaxLength}
              keyboardType="numeric"
            />
          </View>
          <TouchableOpacity
            style={[styles.button, loading && styles.disabled]}
            onPress={handleSubscribe}
            disabled={loading}
          >
            <Text style={styles.buttonText}>Subscribe</Text>
          </TouchableOpacity>
        </View>
      )}

      {videos.length > 0 && (
        <FlatList
          data={videos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.videoItem}>
              <Text style={styles.videoTitle} numberOfLines={1}>
                {item.title}
              </Text>
              {item.duration && (
                <Text style={styles.videoDuration}>
                  {Math.floor(item.duration / 60)}:{String(item.duration % 60).padStart(2, "0")}
                </Text>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  searchRow: {
    flexDirection: "row",
    padding: 16,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    color: "#fff",
  },
  searchBtn: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: "#e94560",
    justifyContent: "center",
    alignItems: "center",
  },
  channelCard: {
    backgroundColor: "#16213e",
    margin: 16,
    borderRadius: 12,
    padding: 16,
  },
  channelTitle: { color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 12 },
  channelActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0f3460",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  subscribeBtn: { backgroundColor: "#e94560" },
  actionText: { color: "#fff", fontSize: 13, fontWeight: "500" },
  subscribeForm: { padding: 16, gap: 12 },
  sectionTitle: {
    color: "#888",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  lengthRow: { flexDirection: "row", gap: 8 },
  lengthInput: { flex: 1 },
  button: {
    backgroundColor: "#e94560",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  videoItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
  },
  videoTitle: { color: "#fff", fontSize: 14, flex: 1 },
  videoDuration: { color: "#888", fontSize: 12 },
});
