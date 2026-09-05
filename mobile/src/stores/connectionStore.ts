import { create } from "zustand";
import { getProvider } from "../providers";

type ConnectionStatus = "checking" | "online" | "offline";

interface ConnectionState {
  status: ConnectionStatus;
  lastChecked: number | null;
  checkConnection: () => Promise<ConnectionStatus>;
  startMonitoring: () => void;
  stopMonitoring: () => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let refCount = 0;

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: "checking",
  lastChecked: null,

  checkConnection: async () => {
    let online = false;
    try {
      const provider = await getProvider();
      online = await provider.ping();
      provider.setReachable(online);
    } catch {
      online = false;
    }
    const status: ConnectionStatus = online ? "online" : "offline";
    set({ status, lastChecked: Date.now() });
    return status;
  },

  startMonitoring: () => {
    refCount += 1;
    if (timer) return;
    get().checkConnection();
    timer = setInterval(() => {
      get().checkConnection();
    }, 15000);
  },

  stopMonitoring: () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  },
}));