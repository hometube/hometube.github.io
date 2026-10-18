import { View } from "react-native";
import { Stack, usePathname } from "expo-router";
import ModeButton from "../../../src/components/ModeButton";
import SettingsButton from "../../../src/components/SettingsButton";
import MiniPlayer from "../../../src/components/MiniPlayer";

export default function PodcastsLayout() {
  const pathname = usePathname();
  const hideMini = pathname.endsWith("/podcasts/playing");

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
        <Stack.Screen name="add" options={{ title: "Add Podcast" }} />
        <Stack.Screen name="[id]" options={{ title: "Podcast Feed" }} />
        <Stack.Screen name="playlist/[id]" options={{ title: "Playlist" }} />
        <Stack.Screen
          name="playing"
          options={{
            headerShown: false,
            presentation: "modal",
            animation: "slide_from_bottom",
            gestureEnabled: true,
          }}
        />
      </Stack>
      {!hideMini && <MiniPlayer scope="podcast" />}
    </View>
  );
}