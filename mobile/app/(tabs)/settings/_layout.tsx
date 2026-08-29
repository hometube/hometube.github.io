import { Stack } from "expo-router";

export default function SettingsLayout() {
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
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="backend" options={{ title: "Backend URL" }} />
      <Stack.Screen name="export" options={{ title: "Export" }} />
      <Stack.Screen name="import" options={{ title: "Import" }} />
    </Stack>
  );
}
