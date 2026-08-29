import { Stack } from "expo-router";

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="videos" />
      <Stack.Screen name="music" />
      <Stack.Screen name="settings" />
    </Stack>
  );
}