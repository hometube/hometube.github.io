import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useModeStore, Mode } from "@/stores/modeStore";

const MODES: {
  key: Mode;
  icon: string;
  label: string;
  color: string;
  available: boolean;
}[] = [
  {
    key: "music",
    icon: "musical-notes",
    label: "Music",
    color: "#4ecca3",
    available: true,
  },
  {
    key: "video",
    icon: "videocam",
    label: "Videos",
    color: "#e94560",
    available: true,
  },
  {
    key: "podcast",
    icon: "headset",
    label: "Podcasts",
    color: "#9070e9",
    available: true,
  },
];

export default function ModeSwitchModal() {
  const mode = useModeStore((s) => s.mode);
  const visible = useModeStore((s) => s.modalVisible);
  const closeModal = useModeStore((s) => s.closeModal);
  const switchMode = useModeStore((s) => s.switchMode);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={closeModal}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={closeModal}
      >
        <TouchableOpacity style={styles.panel} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>Switch Mode</Text>
          <Text style={styles.subtitle}>Choose what you're browsing</Text>

          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.option, active && { borderColor: m.color }]}
                activeOpacity={m.available ? 0.7 : 1}
                disabled={!m.available}
                onPress={() => switchMode(m.key)}
              >
                <View style={[styles.iconWrap, { backgroundColor: m.color }]}>
                  <Ionicons name={m.icon as any} size={22} color="#fff" />
                </View>
                <Text style={styles.optionLabel}>{m.label}</Text>
                {active ? (
                  <Ionicons name="checkmark-circle" size={20} color={m.color} />
                ) : !m.available ? (
                  <Text style={styles.soon}>Soon</Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  panel: {
    width: "78%",
    backgroundColor: "#16213e",
    borderRadius: 16,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: "#888",
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#0f3460",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  optionLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
    flex: 1,
  },
  soon: {
    color: "#777",
    fontSize: 12,
    fontWeight: "600",
  },
});