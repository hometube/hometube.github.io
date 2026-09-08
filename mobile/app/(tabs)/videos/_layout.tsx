import { TouchableOpacity } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useUIStore } from "../../../src/stores/uiStore";
import ConnectionPill from "../../../src/components/ConnectionPill";

export default function VideosLayout() {
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
        headerRight: () => <ConnectionPill />,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Videos" }} />
      <Stack.Screen name="add" options={{ title: "Add Video" }} />
      <Stack.Screen name="channel" options={{ title: "Add Channel" }} />
      <Stack.Screen
        name="[id]"
        options={{ title: "Video Player", headerShown: false }}
      />
    </Stack>
  );
}
