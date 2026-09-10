import { useEffect, useState } from "react";
import { View, StyleProp, ViewStyle, StyleSheet } from "react-native";
import { isLocalModeAsync } from "@/api";
import { useConnectionStore } from "@/stores/connectionStore";

export default function StatusDot({
  size = 8,
  style,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const status = useConnectionStore((s) => s.status);
  const [localMode, setLocalMode] = useState(false);

  useEffect(() => {
    isLocalModeAsync().then(setLocalMode);
  }, []);

  if (localMode) return null;

  const online = status === "online";

  return (
    <View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: online ? "#4ecca3" : "#666",
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
});