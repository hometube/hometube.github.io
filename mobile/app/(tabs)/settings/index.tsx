import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Switch,
  Modal,
} from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { API, getProvider, resetProvider } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useConnectionStore } from "@/stores/connectionStore";
import StatusDot from "@/components/StatusDot";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ProviderType } from "@/types";

export default function Settings() {
  const { user, setUser, loadUser, backendUrl, loadBackendUrl } = useUserStore();
  const showVirtualPlaylists = useSettingsStore((s) => s.showVirtualPlaylists);
  const setShowVirtualPlaylists = useSettingsStore((s) => s.setShowVirtualPlaylists);
  const requestTimeout = useSettingsStore((s) => s.requestTimeout);
  const setRequestTimeout = useSettingsStore((s) => s.setRequestTimeout);
  const loadSettings = useSettingsStore((s) => s.load);
  const connectionStatus = useConnectionStore((s) => s.status);
  const checkConnection = useConnectionStore((s) => s.checkConnection);
  const [providerType, setProviderType] = useState<ProviderType>("server");
  const [showTimeout, setShowTimeout] = useState(false);

  const TIMEOUT_OPTIONS = [5, 15, 30, 60];

  useEffect(() => {
    detectMode();
    loadBackendUrl();
    loadSettings();
    checkConnection();
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

  const handleTimeoutPress = () => {
    setShowTimeout(true);
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
    <>
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
          <>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Ionicons name="wifi" size={20} color="#888" />
                <View>
                  <Text style={styles.rowLabel}>Connection</Text>
                  <Text style={styles.rowSub}>Refreshes every 15 seconds</Text>
                </View>
              </View>
              <View style={styles.rowRight}>
                <StatusDot size={8} />
                <Text
                  style={[
                    styles.rowValue,
                    { fontWeight: "600" },
                    connectionStatus === "online"
                      ? styles.onlineText
                      : styles.offlineText,
                  ]}
                >
                  {connectionStatus === "online"
                    ? "Online"
                    : connectionStatus === "offline"
                    ? "Offline"
                    : "Checking…"}
                </Text>
              </View>
            </View>
            <SettingsRow
              icon="server"
              label="Backend URL"
              value={backendUrl || "Not set"}
              onPress={() => router.push("/(tabs)/settings/backend")}
            />
            <SettingsRow
              icon="timer"
              label="Request Timeout"
              value={`${requestTimeout}s`}
              onPress={handleTimeoutPress}
            />
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Music</Text>
        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="albums" size={20} color="#888" />
            <View>
              <Text style={styles.rowLabel}>Smart Playlists</Text>
              <Text style={styles.rowSub}>
                Show "All Songs" and "My Songs" in Music
              </Text>
            </View>
          </View>
          <Switch
            value={showVirtualPlaylists}
            onValueChange={setShowVirtualPlaylists}
            trackColor={{ false: "#333", true: "#0f3460" }}
            thumbColor={showVirtualPlaylists ? "#4ecca3" : "#555"}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data</Text>
        <SettingsRow
          icon="download"
          label="Export"
          onPress={() => router.push("/(tabs)/settings/export")}
        />
        <SettingsRow
          icon="cloud-upload"
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

      <Modal
        visible={showTimeout}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTimeout(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setShowTimeout(false)}
        >
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Request Timeout</Text>
            <Text style={styles.sheetSub}>
              How long the app waits for a server response.
            </Text>
            {TIMEOUT_OPTIONS.map((sec) => {
              const active = sec === requestTimeout;
              return (
                <TouchableOpacity
                  key={sec}
                  style={styles.sheetItem}
                  onPress={() => {
                    setRequestTimeout(sec);
                    setShowTimeout(false);
                  }}
                >
                  <Text
                    style={[styles.sheetLabel, active && styles.sheetLabelActive]}
                  >
                    {sec} seconds
                  </Text>
                  {active && (
                    <Ionicons name="checkmark-circle" size={20} color="#e94560" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
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
  rowSub: { color: "#888", fontSize: 12, marginTop: 2 },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowValue: { color: "#888", fontSize: 13 },
  onlineText: { color: "#4ecca3" },
  offlineText: { color: "#888" },
  dangerText: { color: "#e94560" },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  bottomSheet: {
    backgroundColor: "#16213e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#333",
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  sheetSub: { color: "#888", fontSize: 13, marginTop: 4, marginBottom: 8 },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  sheetLabel: { color: "#fff", fontSize: 16 },
  sheetLabelActive: { color: "#e94560", fontWeight: "600" },
  version: {
    color: "#444",
    fontSize: 12,
    textAlign: "center",
    marginTop: 40,
    marginBottom: 40,
  },
});
