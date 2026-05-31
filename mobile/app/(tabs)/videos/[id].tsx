import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { VideoView, useVideoPlayer } from "expo-video";
import { useVideoStore } from "@/stores/videoStore";
import { API } from "@/api";
import { Ionicons } from "@expo/vector-icons";
import type { Video } from "@/types";

export default function VideoPlayer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    loadVideo();
  }, [id]);

  const loadVideo = async () => {
    try {
      const videos = await API.get("/videos", {});
      const found = (videos as Video[]).find((v) => v.id === Number(id));
      if (found) {
        setVideo(found);
      } else {
        setError("Video not found");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const videoUrl = video ? API.getVideoUrl(video) : "";
  const player = useVideoPlayer(videoUrl, (p) => {
    p.play();
  });

  const togglePlay = () => {
    if (playing) {
      player.pause();
    } else {
      player.play();
    }
    setPlaying(!playing);
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
