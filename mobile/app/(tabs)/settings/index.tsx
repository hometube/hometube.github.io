import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { API, getProvider, resetProvider } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { Ionicons } from "@expo/vector-icons";
import type { ProviderType } from "@/types";

export default function Settings() {
  const { user, setUser, loadUser, backendUrl, loadBackendUrl } = useUserStore();
  const [providerType, setProviderType] = useState<ProviderType>("server");

  useEffect(() => {
    detectMode();
    loadBackendUrl();
  }, []);

  const detectMode = async () => {
    const localMode = await SecureStore.getItemAsync("localMode");
    setProviderType(localMode === "true" ? "local" : "server");
  };

  const handleToggleMode = async () => {
    const newMode = providerType === "server" ? "local" : "server";
    Alert.alert(
      "Switch Mode",
      newMode === "local"
        ? "Switch to local mode? Data will be read from this device."
        : "Switch to server mode? You'll need a backend URL.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Switch",
          onPress: async () => {
            if (newMode === "local") {
              const { setLocalMode } = await import("@/providers");
              await setLocalMode();
            } else {
              const { setServerMode } = await import("@/providers");
              await setServerMode();
              Alert.alert("Server Mode", "Set your backend URL in the app settings.");
            }
            setProviderType(newMode);
            await resetProvider();
            await loadUser();
          },
        },
      ]
    );
  };

  const handleSwitchUser = async () => {
    await SecureStore.deleteItemAsync("user");
    setUser(null as any);
    router.replace("/welcome/setup-user");
  };

  const handleLogout = async () => {
    Alert.alert("Clear Data", "This will reset the app.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          await SecureStore.deleteItemAsync("user");
          await SecureStore.deleteItemAsync("backendUrl");
          await SecureStore.deleteItemAsync("jwt_token");
          setUser(null as any);
          router.replace("/welcome/setup-backend");
        },
      },
    ]);
  };

  const SettingsRow = ({
    icon,
    label,
    value,
    onPress,
    danger,
  }: {
    icon: string;
    label: string;
    value?: string;
    onPress?: () => void;
    danger?: boolean;
  }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <View style={styles.rowLeft}>
        <Ionicons
          name={icon as any}
          size={20}
          color={danger ? "#e94560" : "#888"}
        />
        <Text style={[styles.rowLabel, danger && styles.dangerText]}>
          {label}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {value && <Text style={styles.rowValue}>{value}</Text>}
        {onPress && (
          <Ionicons name="chevron-forward" size={16} color="#444" />
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>User</Text>
        <SettingsRow
          icon="person"
          label={user?.username || "No user"}
          value={providerType === "server" ? "Server" : "Local"}
          onPress={handleSwitchUser}
        />
        <SettingsRow
          icon="swap-horizontal"
          label="Switch Mode"
          value={providerType === "server" ? "Server Mode" : "Local Mode"}
          onPress={handleToggleMode}
        />
        {providerType === "server" && (
          <SettingsRow
            icon="server"
            label="Backend URL"
            value={backendUrl || "Not set"}
            onPress={() => router.push("/(tabs)/settings/backend")}
          />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data</Text>
        <SettingsRow
          icon="download"
          label="Export"
          onPress={() => router.push("/(tabs)/settings/export")}
        />
        <SettingsRow
          icon="upload"
          label="Import"
          onPress={() => router.push("/(tabs)/settings/import")}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Advanced</Text>
        <SettingsRow
          icon="trash"
          label="Reset App"
          danger
          onPress={handleLogout}
        />
      </View>

      <Text style={styles.version}>HomeTube v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  section: {
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    color: "#888",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 10,
    padding: 14,
    marginBottom: 6,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowLabel: { color: "#fff", fontSize: 15 },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowValue: { color: "#888", fontSize: 13 },
  dangerText: { color: "#e94560" },
  version: {
    color: "#444",
    fontSize: 12,
    textAlign: "center",
    marginTop: 40,
    marginBottom: 40,
  },
});
