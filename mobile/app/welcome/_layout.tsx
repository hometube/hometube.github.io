import { Stack } from "expo-router";

export default function WelcomeLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#121016" },
      }}
    >
      <Stack.Screen name="setup-backend" />
      <Stack.Screen name="setup-user" />
      <Stack.Screen name="scan" options={{ presentation: "modal" }} />
    </Stack>
  );
}
