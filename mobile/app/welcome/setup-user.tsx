import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
} from "react-native";
import { router } from "expo-router";
import { API, getProvider } from "@/api";
import { useUserStore } from "@/stores/userStore";
import type { User } from "@/types";

export default function SetupUser() {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [existingLoading, setExistingLoading] = useState(true);
  const { setUser } = useUserStore();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setExistingLoading(true);
    try {
      const isLocal = true;
      const provider = await getProvider();
      if (provider.type === "local") {
        const { localDb } = require("@/db/localDb");
        const all = await localDb.getAll("users");
        setUsers(all);
      } else {
        const all = await API.get("/users");
        setUsers(all as User[]);
      }
    } catch {
      setUsers([]);
    } finally {
      setExistingLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!username.trim()) return;
    setLoading(true);
    try {
      await setUser({ id: 0, username: username.trim() });
      const result = await API.post("/users", { username: username.trim() });
      await setUser(result);
      router.replace("/(tabs)/videos");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectUser = async (user: User) => {
    setLoading(true);
    try {
      await setUser(user);
      router.replace("/(tabs)/videos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome</Text>
      <Text style={styles.subtitle}>Select or create a user</Text>

      {!existingLoading && users.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Existing Users</Text>
          <FlatList
            data={users}
            keyExtractor={(item) => String(item.id)}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.userItem}
                onPress={() => handleSelectUser(item)}
                disabled={loading}
              >
                <Text style={styles.userName}>{item.username}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
          />
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>New User</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter username"
        placeholderTextColor="#666"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleCreate}
        disabled={loading || !username.trim()}
      >
        <Text style={styles.buttonText}>
          {loading ? "Loading..." : "Continue"}
        </Text>
      </TouchableOpacity>
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
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 14,
    color: "#888",
    marginBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  list: {
    maxHeight: 200,
    marginBottom: 10,
  },
  userItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
  },
  userName: {
    color: "#fff",
    fontSize: 16,
  },
  chevron: {
    color: "#666",
    fontSize: 20,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 16,
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
});
