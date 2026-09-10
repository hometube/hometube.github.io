import { TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import StatusDot from "./StatusDot";

export default function SettingsButton() {
  return (
    <TouchableOpacity
      style={styles.button}
      onPress={() => router.push("/(tabs)/settings")}
      hitSlop={10}
    >
      <Ionicons name="settings-outline" size={22} color="#fff" />
      <StatusDot size={8} style={styles.dot} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dot: {
    position: "absolute",
    top: 2,
    right: 2,
    borderWidth: 1.5,
    borderColor: "#16213e",
  },
});