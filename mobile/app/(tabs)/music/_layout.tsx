import { View } from "react-native";
import { Stack } from "expo-router";
import ModeButton from "../../../src/components/ModeButton";
import SettingsButton from "../../../src/components/SettingsButton";
import MiniPlayer from "../../../src/components/MiniPlayer";

export default function MusicLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: "#16213e" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: "#1a1a2e" },
          headerRight: () => <SettingsButton />,
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: "", headerLeft: () => <ModeButton /> }}
        />
        <Stack.Screen name="add" options={{ title: "Add Music" }} />
        <Stack.Screen name="playlist/[id]" options={{ title: "Playlist" }} />
        <Stack.Screen name="playing" options={{ title: "Playing" }} />
      </Stack>
      <MiniPlayer />
    </View>
  );
}