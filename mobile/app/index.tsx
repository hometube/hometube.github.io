import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { isLocalModeAsync } from "../src/providers";

export default function Index() {
  useEffect(() => {
    async function checkFirstLaunch() {
      const localMode = await isLocalModeAsync();
      const backendUrl = await SecureStore.getItemAsync("backendUrl");
      const user = await SecureStore.getItemAsync("user");

      if (!localMode && !backendUrl) {
        router.replace("/welcome/setup-backend");
      } else if (!user) {
        router.replace("/welcome/setup-user");
      } else {
        router.replace("/(tabs)/videos");
      }
    }
    checkFirstLaunch();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#8a155e" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
  },
});
