import { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { isLocalModeAsync } from "@/api";
import { useConnectionStore } from "@/stores/connectionStore";

export default function ConnectionPill() {
  const status = useConnectionStore((s) => s.status);
  const startMonitoring = useConnectionStore((s) => s.startMonitoring);
  const stopMonitoring = useConnectionStore((s) => s.stopMonitoring);
  const [localMode, setLocalMode] = useState(false);

  useEffect(() => {
    isLocalModeAsync().then(setLocalMode);
  }, []);

  useEffect(() => {
    if (localMode) return;
    startMonitoring();
    return () => stopMonitoring();
  }, [localMode, startMonitoring, stopMonitoring]);

  if (localMode || status === "checking") return null;

  const online = status === "online";

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: online ? "rgba(78,204,163,0.15)" : "rgba(233,69,96,0.15)" },
      ]}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: online ? "#4ecca3" : "#e94560" },
        ]}
      />
      <Text
        style={[
          styles.text,
          { color: online ? "#4ecca3" : "#e94560" },
        ]}
      >
        {online ? "Online" : "Offline"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
});