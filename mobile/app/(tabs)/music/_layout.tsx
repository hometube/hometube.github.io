import { TouchableOpacity } from "react-native";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useUIStore } from "../../../src/stores/uiStore";

export default function MusicLayout() {
  const toggleMenu = useUIStore((s) => s.toggleMenu);

  return (
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
      }}
    >
      <Stack.Screen name="index" options={{ title: "Music" }} />
      <Stack.Screen name="add" options={{ title: "Add Music" }} />
      <Stack.Screen name="now-playing" options={{ title: "Now Playing", headerShown: false }} />
      <Stack.Screen name="playlist/[id]" options={{ title: "Playlist" }} />
    </Stack>
  );
}
