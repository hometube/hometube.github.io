// Desktop pairing: the desktop app shows a QR encoding
//   hometube://pair?url=http://192.168.x.x:8000&token=<single-use>
// which arrives either from the in-app scanner or as a deep link. Both
// paths converge here: store the URL, switch to server mode, and redeem
// the one-time token for the long-lived JWT.
import { Alert } from "react-native";
import { API, setServerMode } from "@/api";
import { useUserStore } from "@/stores/userStore";

export interface PairTarget {
  url: string;
  token: string;
}

// Tolerant parse: accepts hometube://pair?... payloads, bare
// http://host:port?token=... URLs, or "url token" text.
export function parsePairPayload(text: string): PairTarget | null {
  const t = text.trim();
  let url = "";
  let token = "";
  const mUrl = t.match(/[?&]url=([^&\s]+)/);
  const mToken = t.match(/[?&]token=([^&\s]+)/);
  if (mUrl) url = decodeURIComponent(mUrl[1]);
  if (mToken) token = decodeURIComponent(mToken[1]);
  if (!url && /^https?:\/\//i.test(t)) {
    // Plain URL possibly with ?token=
    const q = t.match(/\?token=([^&\s]+)/);
    if (q) token = decodeURIComponent(q[1]);
    url = t.split("?")[0];
  }
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export async function pairWith(payload: string): Promise<{ ok: boolean; error?: string }> {
  const target = parsePairPayload(payload);
  if (!target) return { ok: false, error: "Not a HomeTube pairing code" };
  try {
    await useUserStore.getState().setBackendUrl(target.url);
    await setServerMode();
    await API.exchangeToken(target.token);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Pairing failed" };
  }
}

export async function handlePairPayload(payload: string): Promise<boolean> {
  const res = await pairWith(payload);
  if (!res.ok) {
    Alert.alert("Pairing failed", res.error || "Unknown error");
    return false;
  }
  return true;
}
