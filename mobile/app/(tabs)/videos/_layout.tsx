import { Stack } from "expo-router";

export default function VideosLayout() {
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
