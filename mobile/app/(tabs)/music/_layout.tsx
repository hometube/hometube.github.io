import { View, TouchableOpacity } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useUIStore } from "../../../src/stores/uiStore";
import ConnectionPill from "../../../src/components/ConnectionPill";
import MiniPlayer from "../../../src/components/MiniPlayer";

export default function MusicLayout() {
  const toggleMenu = useUIStore((s) => s.toggleMenu);

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: "#16213e" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: "#1a1a2e" },
          headerLeft: () => (
            <TouchableOpacity onPress={toggleMenu} style={{ marginRight: 16 }}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
          ),
          headerRight: () => <ConnectionPill />,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Music" }} />
        <Stack.Screen name="add" options={{ title: "Add Music" }} />
        <Stack.Screen name="playlist/[id]" options={{ title: "Playlist" }} />
        <Stack.Screen name="playing" options={{ title: "Playing" }} />
      </Stack>
      <MiniPlayer />
    </View>
  );
}