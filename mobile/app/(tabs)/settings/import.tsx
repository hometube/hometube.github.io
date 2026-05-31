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
import * as DocumentPicker from "expo-document-picker";
import { API } from "@/api";
import { Ionicons } from "@expo/vector-icons";

export default function ImportPage() {
  const [loading, setLoading] = useState(false);

  const handlePickFile = async () => {
    setLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        setLoading(false);
        return;
      }

      const file = result.assets[0];

      const provider = await (await import("@/providers")).getProvider();
      if (provider.type === "local") {
        await provider.importData({ uri: file.uri, name: file.name });
      } else {
        await API.importData({
          uri: file.uri,
          name: file.name,
          mimeType: file.mimeType || "application/zip",
        });
      }

      Alert.alert("Imported", "Data imported successfully", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert("Import Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Ionicons name="cloud-upload" size={40} color="#e94560" />
        <Text style={styles.title}>Import Data</Text>
        <Text style={styles.desc}>
          Import a .ht file to restore your HomeTube data. This will replace
          your current local data.
        </Text>
        <TouchableOpacity
          style={[styles.button, loading && styles.disabled]}
          onPress={handlePickFile}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.buttonText}>Select .ht File</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
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
