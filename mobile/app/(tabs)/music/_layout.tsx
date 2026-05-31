import { Stack } from "expo-router";

export default function MusicLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "#16213e" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: "#1a1a2e" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Music" }} />
      <Stack.Screen name="add" options={{ title: "Add Music" }} />
      <Stack.Screen name="now-playing" options={{ title: "Now Playing", headerShown: false }} />
      <Stack.Screen name="playlist/[id]" options={{ title: "Playlist" }} />
    </Stack>
  );
}
