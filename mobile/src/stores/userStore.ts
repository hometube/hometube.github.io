import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { API, getProvider } from "../api";
import type { User } from "../types";

interface UserState {
  user: User | null;
  backendUrl: string;
  isLoading: boolean;
  error: string | null;

  setUser: (user: User) => Promise<void>;
  loadUser: () => Promise<void>;
  createUser: (username: string) => Promise<User>;
  setBackendUrl: (url: string) => Promise<void>;
  loadBackendUrl: () => Promise<void>;
  ping: () => Promise<boolean>;
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  backendUrl: "",
  isLoading: false,
  error: null,

  setUser: async (user) => {
    await SecureStore.setItemAsync("user", JSON.stringify(user));
    set({ user });
  },

  loadUser: async () => {
    const stored = await SecureStore.getItemAsync("user");
    if (stored) {
      try {
        set({ user: JSON.parse(stored) });
      } catch {
        await SecureStore.deleteItemAsync("user");
      }
    }
  },

  createUser: async (username) => {
    set({ isLoading: true, error: null });
    try {
      const users = await API.get("/users");
      const existing = (users as User[]).find(
        (u) => u.username === username
      );
      if (existing) {
        await get().setUser(existing);
        return existing;
      }
      const newUser = await API.post("/users", { username });
      await get().setUser(newUser);
      return newUser;
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  setBackendUrl: async (url) => {
    const clean = url.replace(/\/+$/, "");
    await SecureStore.setItemAsync("backendUrl", clean);
    set({ backendUrl: clean });
    const provider = await getProvider();
    if ("setBackendUrl" in provider) {
      (provider as any).setBackendUrl(clean);
    }
  },

  loadBackendUrl: async () => {
    const url = await SecureStore.getItemAsync("backendUrl");
    if (url) {
      set({ backendUrl: url });
    }
  },

  ping: async () => {
    try {
      return await API.ping();
    } catch {
      return false;
    }
  },
}));
