export interface User {
  id: number;
  username: string;
}

export interface Channel {
  id: number;
  url: string;
  name: string;
}

export interface SubscriptionCriteria {
  keywords?: string[];
  min_length?: number;
  max_length?: number;
  quality?: string;
}

export interface Subscription {
  id: number;
  channel_id: number;
  user_id: number;
  criteria: SubscriptionCriteria;
  check_interval: number;
  last_checked?: string;
  created_at: string;
}

export interface Video {
  id: number;
  video_id: string;
  title: string;
  channel_id?: number;
  url: string;
  downloaded: boolean;
  added_by: number;
  watched_at?: string | null;
  keep_flag: boolean;
  quality: string;
  created_at: string;
  channel_name?: string;
  filename?: string;
}

export interface Music {
  id: number;
  video_id: string;
  url: string;
  title: string;
  artist?: string;
  album_art?: string;
  filename?: string;
  is_playlist: boolean;
  playlist_id?: string;
  downloaded: boolean;
  added_by: number;
  created_at: string;
}

export interface Playlist {
  id: number;
  name: string;
  user_id: number;
  created_at: string;
  songs: PlaylistSong[];
}

export interface PlaylistSong {
  music_id: number;
  position: number;
}

export interface Setting {
  key: string;
  value: string;
}

export interface Download {
  id: number;
  type: "video" | "music";
  item_id: number;
  user_id: number;
  status: string;
  progress: number;
  file_path?: string;
  created_at: string;
}

export interface CacheRule {
  path: string;
  ttl: number;
  refetch: boolean;
}

export interface ExportBody {
  type: "all" | "videos" | "music";
  user_id: number;
  date_from?: string;
  date_to?: string;
  video_ids?: number[];
  music_ids?: number[];
}

export interface HtMetadata {
  version: string;
  exported_at: string;
  users: User[];
  channels: Channel[];
  subscriptions: Subscription[];
  videos: Video[];
  music: Music[];
  playlists: Playlist[];
  settings: Setting[];
}

export type ProviderType = "server" | "local";

export interface SwCacheStatus {
  [path: string]: boolean;
}
