import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  icon?: string;
  title: string;
  message?: string;
}

export function EmptyState({ icon = "albums-outline", title, message }: Props) {
  return (
    <View style={styles.container}>
      <Ionicons name={icon as any} size={48} color="#444" />
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    padding: 20,
  },
  title: {
    color: "#666",
    fontSize: 16,
    marginTop: 12,
  },
  message: {
    color: "#444",
    fontSize: 13,
    marginTop: 4,
  },
});
