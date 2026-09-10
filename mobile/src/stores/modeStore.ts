import { create } from "zustand";
import { router } from "expo-router";

export type Mode = "music" | "video" | "podcast";

interface ModeState {
  mode: Mode;
  modalVisible: boolean;
  setMode: (mode: Mode) => void;
  openModal: () => void;
  closeModal: () => void;
  switchMode: (mode: Mode) => void;
}

export const useModeStore = create<ModeState>((set, get) => ({
  mode: "music",
  modalVisible: false,
  setMode: (mode) => set({ mode }),
  openModal: () => set({ modalVisible: true }),
  closeModal: () => set({ modalVisible: false }),
  switchMode: (mode) => {
    if (mode === get().mode) {
      set({ modalVisible: false });
      return;
    }
    set({ mode, modalVisible: false });
    if (mode === "music") {
      router.push("/(tabs)/music");
    } else if (mode === "video") {
      router.push("/(tabs)/videos");
    } else if (mode === "podcast") {
      router.push("/(tabs)/podcasts");
    }
  },
}));