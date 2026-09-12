import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import { useVideoStore, videoThumb } from "@/stores/videoStore";
import { API } from "@/api";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Video } from "@/types";

const POSITION_FLUSH_MS = 30000;

export default function VideoPlayer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState("");

  const savePosition = useVideoStore((s) => s.savePosition);
  const markWatched = useVideoStore((s) => s.markWatched);
  const toggleKeep = useVideoStore((s) => s.toggleKeep);
  const addVideoToPlaylist = useVideoStore((s) => s.addVideoToPlaylist);
  const videoPlaylists = useVideoStore((s) => s.videoPlaylists);
  const loadVideoPlaylists = useVideoStore((s) => s.loadVideoPlaylists);
  const user = useVideoStore((s) => s.videos.find((v) => v.id === Number(id))?.added_by);

  const positionRef = useRef(0);
  const sawEndRef = useRef(false);

  useEffect(() => {
    loadVideo();
  }, [id]);

  const loadVideo = async () => {
    try {
      const videos = await API.get("/videos", {});
      const found = (videos as Video[]).find((v) => v.id === Number(id));
      if (found) {
        setVideo(found);
        const url = await API.getVideoUrl(found);
        if (url) {
          setVideoUrl(url);
        } else {
          setError("Video file not available. Download it from the feed first.");
        }
      } else {
        setError("Video not found");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const player = useVideoPlayer(videoUrl, (p) => {
    p.play();
  });

  useEffect(() => {
    if (!player || !video) return;
    const resume = video.position && !video.watched_at ? video.position : 0;
    if (resume > 0) player.currentTime = resume;
    positionRef.current = resume;

    const subs = [
      player.addListener("timeUpdate", (e: any) => {
        const current = e.currentTime ?? 0;
        positionRef.current = current;
        if (current % 15 < 1 && current > 5 && current < (video.duration || 1e9) - 5) {
          savePosition(video.id, Math.round(current));
        }
      }),
      player.addListener("playToEnd", () => {
        if (!sawEndRef.current) {
          sawEndRef.current = true;
          markWatched(video.id);
        }
      }),
    ];
    const flush = setInterval(() => {
      if (positionRef.current > 2) {
        savePosition(video.id, Math.round(positionRef.current));
      }
    }, POSITION_FLUSH_MS);

    return () => {
      subs.forEach((s) => s.remove());
      clearInterval(flush);
      if (positionRef.current > 2) {
        const pos = Math.round(positionRef.current);
        const dur = video.duration || 0;
        if (!(dur && pos >= dur * 0.95)) {
          savePosition(video.id, pos);
        }
      }
    };
  }, [player, video]);

  const addToPlaylist = async () => {
    if (!video) return;
    try {
      await loadVideoPlaylists(user!);
      const pls = useVideoStore.getState().videoPlaylists;
      if (pls.length === 0) {
        Alert.alert("No playlist", "Create a playlist from the Videos → Playlists screen first.");
        return;
      }
      const names = pls.map((p, i) => ({ text: p.name, onPress: () => addVideoToPlaylist(p.id, video.id) }));
      Alert.alert("Add to Playlist", "Choose a playlist", [
        ...names.map((n) => ({
          text: n.text,
          onPress: () => n.onPress().then(() => Alert.alert("Added", `Added "${video.title}" to ${n.text}`)),
        })),
        { text: "Cancel", style: "cancel" },
      ]);
    } catch {}
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" />
      </View>
    );
  }

  if (error || !video) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error || "Video not found"}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.playerContainer}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={true}
        />
        <TouchableOpacity style={styles.overlayBack} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.info}>
        <Text style={styles.title}>{video.title}</Text>
        {video.channel_name && (
          <Text style={styles.channel}>{video.channel_name}</Text>
        )}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => toggleKeep(video.id)}
          >
            <Ionicons
              name={video.keep_flag ? "bookmark" : "bookmark-outline"}
              size={18}
              color={video.keep_flag ? "#e94560" : "#aaa"}
            />
            <Text style={styles.actionText}>{video.keep_flag ? "Kept" : "Keep"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={addToPlaylist}>
            <Ionicons name="list" size={18} color="#aaa" />
            <Text style={styles.actionText}>Add to Playlist</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push("/(tabs)/videos/playlists")}>
            <Ionicons name="albums" size={18} color="#aaa" />
            <Text style={styles.actionText}>Playlists</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  playerContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  overlayBack: {
    position: "absolute",
    top: 40,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    padding: 16,
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  channel: {
    color: "#888",
    fontSize: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 16,
    marginTop: 16,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionText: {
    color: "#aaa",
    fontSize: 13,
  },
  errorText: {
    color: "#e94560",
    fontSize: 16,
    textAlign: "center",
    marginTop: 100,
  },
  backBtn: {
    alignSelf: "center",
    marginTop: 20,
    padding: 12,
  },
  backText: {
    color: "#e94560",
    fontSize: 16,
  },
});