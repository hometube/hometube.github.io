import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { router } from "expo-router";
import { API, setLocalMode, setServerMode } from "@/api";

export default function SetupBackend() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleServerMode = async () => {
    if (!url.trim()) {
      Alert.alert("Error", "Please enter the backend server URL");
      return;
    }
    setLoading(true);
    try {
      const cleanUrl = url.replace(/\/+$/, "");
      await setServerMode();
      const store = await import("expo-secure-store");
      await store.default.setItemAsync("backendUrl", cleanUrl);
      router.replace("/welcome/setup-user");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLocalMode = async () => {
    setLoading(true);
    try {
      await setLocalMode();
      router.replace("/welcome/setup-user");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HomeTube</Text>
      <Text style={styles.subtitle}>Choose your mode</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Server Mode</Text>
        <Text style={styles.cardDesc}>
          Connect to a HomeTube backend server for downloads, subscriptions, and
          cloud storage.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="http://your-server:8000"
          placeholderTextColor="#666"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleServerMode}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "Connecting..." : "Connect"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity
        style={[styles.button, styles.localButton, loading && styles.buttonDisabled]}
        onPress={handleLocalMode}
        disabled={loading}
      >
        <Text style={styles.buttonText}>Use Local Mode</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        Local mode stores everything on this device. Switch anytime in Settings.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    padding: 20,
    justifyContent: "center",
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#e94560",
    textAlign: "center",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    textAlign: "center",
    marginBottom: 40,
  },
  card: {
    backgroundColor: "#16213e",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 13,
    color: "#888",
    marginBottom: 16,
    lineHeight: 18,
  },
  input: {
    backgroundColor: "#0f3460",
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
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  localButton: {
    backgroundColor: "#0f3460",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#333",
  },
  dividerText: {
    color: "#666",
    marginHorizontal: 12,
    fontSize: 12,
  },
  hint: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    marginTop: 20,
  },
});
