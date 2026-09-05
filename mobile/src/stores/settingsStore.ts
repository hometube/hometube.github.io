import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { getProvider } from "../providers";

const KEY = "showVirtualPlaylists";
const REQUEST_TIMEOUT_KEY = "requestTimeout";
const DEFAULT_REQUEST_TIMEOUT = 5;

interface SettingsState {
  showVirtualPlaylists: boolean;
  requestTimeout: number;
  loaded: boolean;
  load: () => Promise<void>;
  setShowVirtualPlaylists: (value: boolean) => Promise<void>;
  setRequestTimeout: (seconds: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  showVirtualPlaylists: true,
  requestTimeout: DEFAULT_REQUEST_TIMEOUT,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const stored = await SecureStore.getItemAsync(KEY);
    const timeoutStored = await SecureStore.getItemAsync(REQUEST_TIMEOUT_KEY);
    const timeout = parseInt(timeoutStored || "", 10);
    set({
      showVirtualPlaylists: stored !== "false",
      requestTimeout:
        isNaN(timeout) || timeout <= 0
          ? DEFAULT_REQUEST_TIMEOUT
          : timeout,
      loaded: true,
    });
  },

  setShowVirtualPlaylists: async (value) => {
    await SecureStore.setItemAsync(KEY, String(value));
    set({ showVirtualPlaylists: value });
  },

  setRequestTimeout: async (seconds) => {
    const value = Math.max(1, Math.round(seconds));
    await SecureStore.setItemAsync(REQUEST_TIMEOUT_KEY, String(value));
    set({ requestTimeout: value });
    const provider = await getProvider();
    provider.setRequestTimeout(value);
  },
}));