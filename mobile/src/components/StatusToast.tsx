import { useEffect, useRef, useState } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isLocalModeAsync } from "@/api";
import { useConnectionStore } from "@/stores/connectionStore";

const SHOW_MS = 3000;

export default function StatusToast() {
  const insets = useSafeAreaInsets();
  const status = useConnectionStore((s) => s.status);
  const startMonitoring = useConnectionStore((s) => s.startMonitoring);
  const stopMonitoring = useConnectionStore((s) => s.stopMonitoring);
  const [localMode, setLocalMode] = useState(false);
  const [visible, setVisible] = useState(false);
  const prevStatus = useRef("checking");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    isLocalModeAsync().then(setLocalMode);
  }, []);

  useEffect(() => {
    if (localMode) return;
    startMonitoring();
    return () => stopMonitoring();
  }, [localMode, startMonitoring, stopMonitoring]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (localMode) return;
    const prev = prevStatus.current;
    if (status === prev) return;
    prevStatus.current = status;
    if (status === "checking") return;

    if (hideTimer.current) clearTimeout(hideTimer.current);
    setVisible(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setVisible(false);
      });
    }, SHOW_MS);
  }, [status, localMode, opacity]);

  if (localMode || !visible) return null;

  const online = status === "online";
  const color = online ? "#4ecca3" : "#888";

  return (
    <View
      pointerEvents="none"
      style={[styles.wrapper, { top: insets.top + 56 }]}
    >
      <Animated.View style={[styles.pill, { opacity }]}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.text, { color }]}>
          {online ? "Online" : "Offline"}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 1000,
    elevation: 10,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#16213e",
    borderWidth: 1,
    borderColor: "#0f3460",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
  },
});