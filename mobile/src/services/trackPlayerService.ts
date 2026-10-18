import TrackPlayer, { Event } from "react-native-track-player";
import { useMusicStore } from "../stores/musicStore";

export async function TrackPlayerService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play();
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause();
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.reset();
  });

  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    TrackPlayer.skipToNext();
  });

  TrackPlayer.addEventListener(Event.RemotePrevious, async () => {
    const progress = await TrackPlayer.getProgress();
    const position = Number.isFinite(progress.position) ? progress.position : 0;
    if (position >= 1) {
      await TrackPlayer.seekTo(0);
    } else {
      await TrackPlayer.skipToPrevious();
    }
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, (event) => {
    TrackPlayer.seekTo(event.position);
  });

  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, () => {
    useMusicStore.getState().setPlaybackError(null);
  });

  TrackPlayer.addEventListener(Event.PlaybackError, (event: any) => {
    const detail = event?.error || "";
    useMusicStore.getState().setPlaybackError(
      `Playback failed — file not available on the server${detail ? `: ${detail}` : ""}. Download it first or skip this track.`
    );
  });
}
