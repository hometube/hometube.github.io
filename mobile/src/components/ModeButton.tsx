import { TouchableOpacity, Text, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useModeStore, Mode } from "@/stores/modeStore";

const MODE_ICONS: Record<Mode, string> = {
  music: "musical-notes",
  video: "videocam",
  podcast: "headset",
};

const MODE_LABELS: Record<Mode, string> = {
  music: "Music",
  video: "Videos",
  podcast: "Podcasts",
};

export default function ModeButton() {
  const mode = useModeStore((s) => s.mode);
  const openModal = useModeStore((s) => s.openModal);

  return (
    <TouchableOpacity style={styles.button} onPress={openModal} hitSlop={10}>
      <Ionicons name={MODE_ICONS[mode] as any} size={20} color="#fff" />
      <Text style={styles.label}>{MODE_LABELS[mode]}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  label: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});