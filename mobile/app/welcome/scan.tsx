// QR scanner for desktop pairing. The desktop app renders
// hometube://pair?url=...&token=...; we scan, redeem, and continue setup.
import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { handlePairPayload } from "@/pairing";

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);

  const onScan = async (result: BarcodeScanningResult) => {
    if (busy || !result.data) return;
    setBusy(true);
    const ok = await handlePairPayload(result.data);
    if (ok) {
      const user = await SecureStore.getItemAsync("user");
      router.replace(user ? "/(tabs)/music" : "/welcome/setup-user");
    } else {
      setBusy(false);
    }
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Starting camera…</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Camera access is needed to scan a pairing code.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Allow camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={busy ? undefined : onScan}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.hint}>Point at the HomeTube desktop pairing code</Text>
      </View>
      <TouchableOpacity style={styles.close} onPress={() => router.back()}>
        <Text style={styles.buttonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  center: {
    flex: 1,
    backgroundColor: "#121016",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: "#e0559b",
  },
  hint: {
    color: "#fff",
    marginTop: 20,
    fontSize: 14,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#e0559b",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  secondary: {
    backgroundColor: "#9b2fbf",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  close: {
    position: "absolute",
    bottom: 44,
    alignSelf: "center",
    backgroundColor: "#9b2fbf",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
});
