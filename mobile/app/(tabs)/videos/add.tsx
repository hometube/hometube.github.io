import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { Ionicons } from "@expo/vector-icons";

interface Format {
  format_id: string;
  ext: string;
  resolution?: string;
  filesize?: number;
  format_note?: string;
}

export default function AddVideo() {
  const { user } = useUserStore();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [formats, setFormats] = useState<Format[]>([]);
  const [selectedQuality, setSelectedQuality] = useState("");
  const [fetchingFormats, setFetchingFormats] = useState(false);

  const handleFetchFormats = async () => {
    if (!url.trim()) return;
    setFetchingFormats(true);
    try {
      const info = await API.get("/videos/info", { url: url.trim() });
      setFormats(info.formats || []);
      if (info.formats?.length > 0) {
        setSelectedQuality(info.formats[0].format_id);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setFetchingFormats(false);
    }
  };

  const handleAdd = async () => {
    if (!url.trim() || !user) return;
    setLoading(true);
    try {
      await API.post("/videos/add", {
        url: url.trim(),
        user_id: user.id,
        quality: selectedQuality || "best",
      });
      Alert.alert("Added", "Video has been added", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.label}>Video URL</Text>
      <TextInput
        style={styles.input}
        placeholder="https://www.youtube.com/watch?v=..."
        placeholderTextColor="#666"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity
        style={[styles.button, styles.secondaryBtn, fetchingFormats && styles.disabled]}
        onPress={handleFetchFormats}
        disabled={fetchingFormats || !url.trim()}
      >
        {fetchingFormats ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Fetch Available Qualities</Text>
        )}
      </TouchableOpacity>

      {formats.length > 0 && (
        <View style={styles.formatsSection}>
          <Text style={styles.sectionTitle}>Select Quality</Text>
          {formats.map((fmt) => (
            <TouchableOpacity
              key={fmt.format_id}
              style={[
                styles.formatItem,
                selectedQuality === fmt.format_id && styles.formatItemActive,
              ]}
              onPress={() => setSelectedQuality(fmt.format_id)}
            >
              <View style={styles.formatInfo}>
                <Text style={styles.formatName}>
                  {fmt.format_note || fmt.resolution || fmt.ext}
                </Text>
                <Text style={styles.formatExt}>{fmt.ext}</Text>
              </View>
              {selectedQuality === fmt.format_id && (
                <Ionicons name="checkmark-circle" size={20} color="#e94560" />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, loading && styles.disabled]}
        onPress={handleAdd}
        disabled={loading || !url.trim()}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Add Video</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  label: { color: "#fff", fontSize: 14, fontWeight: "600", marginBottom: 8 },
  input: {
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    color: "#fff",
    marginBottom: 12,
  },
  button: {
    backgroundColor: "#e94560",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  secondaryBtn: { backgroundColor: "#0f3460", marginTop: 0 },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  formatsSection: { marginTop: 20, marginBottom: 12 },
  sectionTitle: {
    color: "#888",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  formatItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
  },
  formatItemActive: { borderColor: "#e94560", borderWidth: 1 },
  formatInfo: { flexDirection: "row", gap: 8, alignItems: "center" },
  formatName: { color: "#fff", fontSize: 14 },
  formatExt: { color: "#888", fontSize: 12 },
});
