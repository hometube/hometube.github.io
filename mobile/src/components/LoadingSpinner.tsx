import { View, ActivityIndicator, StyleSheet, Text } from "react-native";

interface Props {
  message?: string;
}

export function LoadingSpinner({ message }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#e94560" />
      {message && <Text style={styles.text}>{message}</Text>}
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
  text: {
    color: "#888",
    fontSize: 14,
    marginTop: 12,
  },
});
