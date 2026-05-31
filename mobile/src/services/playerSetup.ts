import TrackPlayer from "react-native-track-player";
import { TrackPlayerService } from "./trackPlayerService";

TrackPlayer.registerPlaybackService(() => TrackPlayerService);
