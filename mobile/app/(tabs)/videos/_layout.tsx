import { Stack } from "expo-router";
import ModeButton from "../../../src/components/ModeButton";
import SettingsButton from "../../../src/components/SettingsButton";

export default function VideosLayout() {
  return (
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
      <Stack.Screen name="add" options={{ title: "Add Video" }} />
      <Stack.Screen name="channel" options={{ title: "Add Channel" }} />
      <Stack.Screen
        name="[id]"
        options={{ title: "Video Player", headerShown: false }}
      />
    </Stack>
  );
}