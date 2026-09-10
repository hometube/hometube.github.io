import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  ScrollView,
  TextInput,
} from "react-native";
import { FlatList } from "react-native";
import { router } from "expo-router";
import { API } from "@/api";
import { useUserStore } from "@/stores/userStore";
import { usePodcastStore } from "@/stores/podcastStore";
import { useMusicStore } from "@/stores/musicStore";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Music, PodcastFeed, Playlist } from "@/types";

export default function PodcastsHome() {
  const { user } = useUserStore();
  const feeds = usePodcastStore((s) => s.feeds);
  const playlists = usePodcastStore((s) => s.playlists);
  const isLoading = usePodcastStore((s) => s.isLoading);
  const isChecking = usePodcastStore((s) => s.isChecking);
  const load = usePodcastStore((s) => s.load);
  const checkNow = usePodcastStore((s) => s.checkNow);
  const unsubscribe = usePodcastStore((s) => s.unsubscribe);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFeed, setMenuFeed] = useState<PodcastFeed | null>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [episodeCache, setEpisodeCache] = useState<Record<number, Music[]>>({});
  const [cacheLoading, setCacheLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playNow = useMusicStore((s) => s.playNow);

  const searching = focused || query.trim().length > 0;

  const loadEpisodeCache = useCallback(async () => {
    if (!query.trim()) return;
    const cache: Record<number, Music[]> = { ...episodeCache };
    const pending = feeds.filter((f) => !(f.subscription_id in cache));
    if (pending.length === 0) return;
    setCacheLoading(true);
    await Promise.all(
      pending.map(async (f) => {
        try {
          const res = (await API.get(`/podcasts/${f.subscription_id}/episodes`, {})) as {
            episodes: Music[];
          };
          cache[f.subscription_id] = res.episodes || [];
        } catch {
          cache[f.subscription_id] = [];
        }
      })
    );
    setEpisodeCache(cache);
    setCacheLoading(false);
  }, [query, episodeCache, feeds]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim()) {
      searchTimer.current = setTimeout(loadEpisodeCache, 300);
    }
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, loadEpisodeCache]);

  const matchedEpisodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Music[] = [];
    const seen = new Set<number>();
    for (const f of feeds) {
      const eps = episodeCache[f.subscription_id] || [];
      const toAdd =
        (f.channel_name || "").toLowerCase().includes(q)
          ? eps
          : eps.filter((e) => (e.title || "").toLowerCase().includes(q));
      for (const e of toAdd) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          out.push(e);
        }
      }
    }
    return out;
  }, [query, feeds, episodeCache]);

  useEffect(() => {
    if (user) load(user.id);
  }, [user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (user) await load(user.id, true);
    setRefreshing(false);
  }, [user]);

  const exitSearch = useCallback(() => {
    setQuery("");
    setFocused(false);
  }, []);

  const handleCheckNow = async (feed: PodcastFeed) => {
    setMenuFeed(null);
    await checkNow(feed.subscription_id);
  };

  const handleUnsubscribe = (feed: PodcastFeed) => {
    setMenuFeed(null);
    Alert.alert("Unsubscribe", `Unsubscribe from "${feed.channel_name}"? Episodes stay in your library.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unsubscribe",
        style: "destructive",
        onPress: () => unsubscribe(feed.subscription_id),
      },
    ]);
  };

  const handlePlaylistPress = (playlist: Playlist) => {
    router.push(
      `/(tabs)/podcasts/playlist/${playlist.id}?name=${encodeURIComponent(
        playlist.name
      )}`
    );
  };

  const feedMenuItems = (feed: PodcastFeed) => [
    {
      icon: "refresh",
      label: "Check for new episodes",
      color: "#4ecca3",
      onPress: () => handleCheckNow(feed),
    },
    {
      icon: "trash",
      label: "Unsubscribe",
      color: "#e94560",
      onPress: () => handleUnsubscribe(feed),
    },
  ];

  const renderEpisode = useCallback(
    ({ item }: { item: Music }) => (
      <TouchableOpacity
        style={styles.episodeItem}
        onPress={() => playNow(item)}
      >
        <View style={styles.episodeIcon}>
          <Ionicons name="radio" size={20} color="#9070e9" />
        </View>
        <View style={styles.feedInfo}>
          <Text style={styles.episodeTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.artist ? (
            <Text style={styles.feedMeta} numberOfLines={1}>
              {item.artist}
            </Text>
          ) : null}
        </View>
        {item.downloaded && (
          <Ionicons name="checkmark-circle" size={16} color="#4ecca3" />
        )}
        <Ionicons name="play-circle-outline" size={22} color="#666" />
      </TouchableOpacity>
    ),
    [playNow]
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color="#666" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search feeds, playlists & episodes…"
            placeholderTextColor="#666"
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQuery("");
                setFocused(true);
              }}
            >
              <Ionicons name="close-circle" size={16} color="#666" />
            </TouchableOpacity>
          )}
        </View>
        {searching ? (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={exitSearch}
            accessibilityLabel="Exit search"
          >
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => router.push("/(tabs)/podcasts/add")}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {searching ? (
        query.trim().length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search" size={48} color="#444" />
            <Text style={styles.emptyText}>Type to search</Text>
            <Text style={styles.emptyHint}>Search by feed, episode title, or playlist</Text>
          </View>
        ) : cacheLoading && matchedEpisodes.length === 0 ? (
          <ActivityIndicator size="large" color="#9070e9" style={{ marginTop: 40 }} />
        ) : matchedEpisodes.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="search" size={48} color="#444" />
            <Text style={styles.emptyText}>No matches</Text>
            <Text style={styles.emptyHint}>Try a different search</Text>
          </View>
        ) : (
          <FlatList
            data={matchedEpisodes}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderEpisode}
            ListHeaderComponent={
              <Text style={styles.resultsLabel}>
                {matchedEpisodes.length} episode{matchedEpisodes.length === 1 ? "" : "s"}
              </Text>
            }
            contentContainerStyle={{ paddingBottom: 120 }}
          />
        )
      ) : (
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#9070e9"
          />
        }
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {isLoading && feeds.length === 0 && playlists.length === 0 ? (
          <ActivityIndicator size="large" color="#9070e9" style={{ marginTop: 40 }} />
        ) : feeds.length === 0 && playlists.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="radio-outline" size={48} color="#444" />
            <Text style={styles.emptyText}>No podcasts yet</Text>
            <Text style={styles.emptyHint}>Tap + to subscribe to a channel or add an episode</Text>
          </View>
        ) : (
          <>
            {feeds.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Feeds</Text>
                {feeds.map((feed) => (
                  <TouchableOpacity
                    key={feed.subscription_id}
                    style={styles.feedCard}
                    onPress={() =>
                      router.push(`/(tabs)/podcasts/${feed.subscription_id}`)
                    }
                  >
                    <View style={styles.feedIcon}>
                      <Ionicons name="radio" size={24} color="#9070e9" />
                    </View>
                    <View style={styles.feedInfo}>
                      <Text style={styles.feedName} numberOfLines={1}>
                        {feed.channel_name}
                      </Text>
                      <Text style={styles.feedMeta}>
                        {feed.episode_count} episodes
                        {feed.downloaded_count > 0
                          ? ` · ${feed.downloaded_count} offline`
                          : ""}
                      </Text>
                      {feed.last_checked ? (
                        <Text style={styles.feedChecked} numberOfLines={1}>
                          Last checked:{" "}
                          {new Date(feed.last_checked).toLocaleString()}
                        </Text>
                      ) : (
                        <Text style={styles.feedChecked}>Never checked</Text>
                      )}
                    </View>
                    {isChecking ? (
                      <ActivityIndicator size="small" color="#9070e9" />
                    ) : (
                      <TouchableOpacity
                        style={styles.feedMenuBtn}
                        onPress={() => setMenuFeed(feed)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="ellipsis-horizontal" size={18} color="#666" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                ))}
              </>
            )}

            {playlists.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Podcast Playlists</Text>
                {playlists.map((playlist) => (
                  <TouchableOpacity
                    key={playlist.id}
                    style={styles.feedCard}
                    onPress={() => handlePlaylistPress(playlist)}
                  >
                    <View style={[styles.feedIcon, styles.playlistIcon]}>
                      <Ionicons name="folder" size={24} color="#4ecca3" />
                    </View>
                    <View style={styles.feedInfo}>
                      <Text style={styles.feedName} numberOfLines={1}>
                        {playlist.name}
                      </Text>
                      <Text style={styles.feedMeta}>
                        {playlist.songs?.length || 0} episodes
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#444" />
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
      )}

      <Modal
        visible={!!menuFeed}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuFeed(null)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setMenuFeed(null)}
        >
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {menuFeed?.channel_name || ""}
            </Text>
            {menuFeed &&
              feedMenuItems(menuFeed).map((item, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.sheetItem}
                  onPress={item.onPress}
                >
                  <Ionicons name={item.icon as any} size={22} color={item.color} />
                  <Text style={[styles.sheetLabel, { color: item.color }]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  resultsLabel: {
    color: "#888",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  episodeItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 12,
  },
  episodeIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "rgba(144,112,233,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  episodeTitle: { color: "#fff", fontSize: 14, fontWeight: "500", marginBottom: 2 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    padding: 16,
    paddingBottom: 8,
  },
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 6,
    height: 36,
    flexShrink: 1,
  },
  searchInput: { flex: 1, color: "#fff", fontSize: 14, padding: 0 },
  heading: { color: "#fff", fontSize: 20, fontWeight: "700" },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#9070e9",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  sectionLabel: {
    color: "#888",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  feedCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16213e",
    borderRadius: 10,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  feedIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "rgba(144,112,233,0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  playlistIcon: { backgroundColor: "rgba(78,204,163,0.15)" },
  feedInfo: { flex: 1 },
  feedName: { color: "#fff", fontSize: 16, fontWeight: "500", marginBottom: 2 },
  feedMeta: { color: "#888", fontSize: 12 },
  feedChecked: { color: "#555", fontSize: 11, marginTop: 2 },
  feedMenuBtn: { padding: 6 },
  empty: { justifyContent: "center", alignItems: "center", paddingTop: 60 },
  emptyText: { color: "#666", fontSize: 16, marginTop: 12 },
  emptyHint: { color: "#444", fontSize: 13, marginTop: 4, textAlign: "center", paddingHorizontal: 32 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  bottomSheet: {
    backgroundColor: "#16213e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#333",
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
  },
  sheetLabel: { fontSize: 16 },
});