import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useUIStore } from "@/stores/uiStore";

export default function HamburgerMenu() {
  const { menuOpen, setMenuOpen } = useUIStore();

  if (!menuOpen) return null;

  const navigate = (path: string) => {
    setMenuOpen(false);
    router.push(path as any);
  };

  const navItems = [
    {
      section: "Video",
      items: [
        { icon: "home", label: "Video Home", path: "/(tabs)/videos" },
        { icon: "add-circle", label: "Add Video", path: "/(tabs)/videos/add" },
        { icon: "tv", label: "Add Channel", path: "/(tabs)/videos/channel" },
      ],
    },
    {
      section: "Music",
      items: [
        { icon: "home", label: "Music Home", path: "/(tabs)/music" },
        { icon: "add-circle", label: "Add Music", path: "/(tabs)/music/add" },
      ],
    },
    {
      section: "App",
      items: [
        { icon: "settings", label: "Settings", path: "/(tabs)/settings" },
        { icon: "download", label: "Export Data", path: "/(tabs)/settings/export" },
        { icon: "cloud-upload", label: "Import Data", path: "/(tabs)/settings/import" },
      ],
    },
  ];

  return (
    <TouchableOpacity
      style={styles.overlay}
      activeOpacity={1}
      onPress={() => setMenuOpen(false)}
    >
      <TouchableOpacity
        style={styles.panel}
        activeOpacity={1}
        onPress={() => {}}
      >
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.header}>
            <Text style={styles.title}>Menu</Text>
            <TouchableOpacity onPress={() => setMenuOpen(false)}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {navItems.map((section) => (
              <View key={section.section} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.section}</Text>
                {section.items.map((item) => (
                  <TouchableOpacity
                    key={item.path}
                    style={styles.menuItem}
                    onPress={() => navigate(item.path)}
                  >
                    <Ionicons name={item.icon as any} size={20} color="#fff" />
                    <Text style={styles.menuItemText}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 1000,
  },
  panel: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: "70%",
    backgroundColor: "#16213e",
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    paddingTop: 8,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: "#666",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  menuItemText: {
    color: "#fff",
    fontSize: 16,
  },
});
