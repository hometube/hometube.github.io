import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { Ionicons } from "@expo/vector-icons";

export default function ExportPage() {
  const { user } = useUserStore();
  const [loading, setLoading] = useState(false);

  const handleExportAll = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const provider = await (await import("@/providers")).getProvider();
      if (provider.type === "local") {
        const metadata = await provider.getMetadata();
        const { zip } = await import("fflate");
        const files: Record<string, Uint8Array> = {};
        const encoder = new TextEncoder();
        files["metadata.json"] = encoder.encode(JSON.stringify(metadata, null, 2));

        const zipData = await new Promise<Uint8Array>((resolve, reject) => {
          zip(files, { level: 6 }, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });

        const fileName = `hometube_export_${Date.now()}.ht`;
        const filePath = `${FileSystem.documentDirectory}${fileName}`;
        const base64 = arrayToBase64(zipData);
        await FileSystem.writeAsStringAsync(filePath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        await Sharing.shareAsync(filePath, {
          mimeType: "application/zip",
        });
      } else {
        const result = await API.exportData({
          type: "all",
          user_id: user.id,
        });
        const filePath = `${FileSystem.documentDirectory}${result}`;
        await Sharing.shareAsync(filePath, {
          mimeType: "application/zip",
        });
      }
      Alert.alert("Exported", "Data exported successfully");
      router.back();
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Ionicons name="download" size={40} color="#e94560" />
        <Text style={styles.title}>Export Data</Text>
        <Text style={styles.desc}>
          Export your HomeTube data as a .ht file. This includes your videos,
          music, playlists, and settings.
        </Text>
        <TouchableOpacity
          style={[styles.button, loading && styles.disabled]}
          onPress={handleExportAll}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.buttonText}>Export All</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function arrayToBase64(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e", padding: 16 },
  card: {
    backgroundColor: "#16213e",
    borderRadius: 12,
    padding: 24,
    alignItems: "center",
    marginTop: 40,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "700", marginTop: 12, marginBottom: 8 },
  desc: { color: "#888", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 20 },
  button: {
    backgroundColor: "#e94560",
    borderRadius: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    alignItems: "center",
    width: "100%",
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
