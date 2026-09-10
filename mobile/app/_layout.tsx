import "../src/services/playerSetup";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useUserStore } from "../src/stores/userStore";
import { useMusicStore, setupMusicPlayback } from "../src/stores/musicStore";
import { useConnectionStore } from "../src/stores/connectionStore";
import { localDb } from "../src/db/localDb";
import TrackPlayer from "react-native-track-player";
import ModeTracker from "../src/components/ModeTracker";
import ModeSwitchModal from "../src/components/ModeSwitchModal";
import StatusToast from "../src/components/StatusToast";

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
      setupMusicPlayback();
      await useMusicStore.getState().restorePlaybackState();
      try {
        await localDb.init();
      } catch (e) {
        console.log("localDb init error:", e);
      }
    }
    init();

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        useConnectionStore.getState().checkConnection();
      }
      if (next !== "active") {
        useMusicStore.getState().savePlaybackState();
      }
    });
    return () => appStateSub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="welcome" />
          <Stack.Screen name="(tabs)" />
        </Stack>
        <ModeTracker />
        <ModeSwitchModal />
        <StatusToast />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
