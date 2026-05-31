import * as SecureStore from "expo-secure-store";
import { DataProvider } from "./DataProvider";
import { ServerProvider } from "./ServerProvider";
import { LocalProvider } from "./LocalProvider";

type ModeChangeListener = (mode: "server" | "local") => void;

let _provider: DataProvider | null = null;
const _listeners: ModeChangeListener[] = [];

function _detectMode(): "server" | "local" {
  return "server";
}

async function _detectModeAsync(): Promise<"server" | "local"> {
  const stored = await SecureStore.getItemAsync("localMode");
  return stored === "true" ? "local" : "server";
}

async function _buildProvider(): Promise<DataProvider> {
  const mode = await _detectModeAsync();
  if (mode === "local") {
    const { LocalProvider } = require("./LocalProvider");
    const prov = new LocalProvider();
    await prov.init();
    return prov;
  }
  const prov = new ServerProvider();
  await prov.init();
  return prov;
}

export async function getProvider(): Promise<DataProvider> {
  if (!_provider) {
    _provider = await _buildProvider();
  }
  return _provider;
}

export async function setLocalMode(): Promise<void> {
  await SecureStore.setItemAsync("localMode", "true");
  _provider = null;
  _notify("local");
}

export async function setServerMode(): Promise<void> {
  await SecureStore.setItemAsync("localMode", "false");
  _provider = null;
  _notify("server");
}

export function isLocalMode(): boolean {
  return _detectMode() === "local";
}

export async function isLocalModeAsync(): Promise<boolean> {
  return (await _detectModeAsync()) === "local";
}

export function onModeChange(fn: ModeChangeListener): () => void {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

function _notify(mode: "server" | "local"): void {
  for (const fn of _listeners) {
    fn(mode);
  }
}

export async function resetProvider(): Promise<void> {
  _provider = null;
  await getProvider();
}

export { DataProvider, ServerProvider, LocalProvider };
