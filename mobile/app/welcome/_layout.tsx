import { Stack } from "expo-router";

export default function WelcomeLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#1a1a2e" },
      }}
    >
      <Stack.Screen name="setup-backend" />
      <Stack.Screen name="setup-user" />
    </Stack>
  );
}
