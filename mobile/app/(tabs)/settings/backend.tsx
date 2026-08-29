import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { API, getProvider, resetProvider } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { Ionicons } from "@expo/vector-icons";

export default function BackendSettings() {
  const { setBackendUrl, loadBackendUrl, loadUser } = useUserStore();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    await loadBackendUrl();
    const stored = await SecureStore.getItemAsync("backendUrl");
    setUrl((stored || "").replace(/\/+$/, ""));
  };

  const handleSave = async (test: boolean) => {
    const trimmed = url.trim();
    if (!trimmed) {
      Alert.alert("Error", "Please enter a backend server URL");
      return;
    }
    setLoading(true);
    try {
      const withScheme = /^\w+:\/\//.test(trimmed)
        ? trimmed
        : `http://${trimmed}`;
      const parsed = new URL(withScheme);
      const tempToken = parsed.searchParams.get("token");
      const cleanUrl = withScheme.split("?")[0].replace(/\/+$/, "");

      await setBackendUrl(cleanUrl);
      await resetProvider();

      const provider = await getProvider();
      if (provider.type === "server" && test) {
        const ok = await provider.ping();
        if (!ok) {
          Alert.alert(
            "Connection Failed",
            "Could not reach the server. Check the URL and try again."
          );
          return;
        }
        if (tempToken) {
          try {
            await API.exchangeToken(tempToken);
          } catch (e) {
            console.log("Token exchange failed (non-fatal):", e);
          }
        }
        await loadUser();
      }
      Alert.alert("Saved", "Backend URL updated");
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
        <Ionicons name="server" size={36} color="#e94560" />
        <Text style={styles.title}>Backend URL</Text>
        <Text style={styles.desc}>
          The URL where your HomeTube backend is running (e.g.
          http://192.168.1.10:8000). For ngrok or public URLs, append
          ?token=your-secret-code.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="http://your-server:8000"
          placeholderTextColor="#666"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TouchableOpacity
          style={[styles.button, loading && styles.disabled]}
          onPress={() => handleSave(true)}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Test Connection & Save</Text>
          )}
        </TouchableOpacity>
        {!loading && (
          <TouchableOpacity style={styles.secondary} onPress={() => handleSave(false)}>
            <Text style={styles.secondaryText}>Save Only</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    padding: 16,
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#16213e",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    marginTop: 8,
    marginBottom: 8,
  },
  desc: {
    fontSize: 13,
    color: "#888",
    textAlign: "center",
    marginBottom: 16,
    lineHeight: 18,
  },
  input: {
    alignSelf: "stretch",
    backgroundColor: "#0f3460",
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    color: "#fff",
    marginBottom: 12,
  },
  button: {
    alignSelf: "stretch",
    backgroundColor: "#e94560",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 4,
  },
  disabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondary: {
    alignSelf: "stretch",
    alignItems: "center",
    padding: 12,
  },
  secondaryText: {
    color: "#888",
    fontSize: 14,
  },
});