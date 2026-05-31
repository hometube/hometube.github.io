import "../src/services/playerSetup";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useUserStore } from "../src/stores/userStore";
import { localDb } from "../src/db/localDb";
import TrackPlayer from "react-native-track-player";

export default function RootLayout() {
  const { loadUser, loadBackendUrl } = useUserStore();

  useEffect(() => {
    async function init() {
      await loadUser();
      await loadBackendUrl();
      try {
        await TrackPlayer.setupPlayer();
      } catch (e) {
        console.log("TrackPlayer already initialized");
      }
      try {
        await localDb.init();
      } catch (e) {
        console.log("localDb init error:", e);
      }
    }
    init();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </GestureHandlerRootView>
  );
}
