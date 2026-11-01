import { Stack } from "expo-router";

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: "#1c1922" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: "#121016" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="backend" options={{ title: "Backend URL" }} />
      <Stack.Screen name="export" options={{ title: "Export" }} />
      <Stack.Screen name="import" options={{ title: "Import" }} />
    </Stack>
  );
}