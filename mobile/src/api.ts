import { getProvider, setLocalMode, setServerMode, isLocalModeAsync, onModeChange, resetProvider } from "./providers";
import type { DataProvider } from "./providers/DataProvider";

function createApiProxy(): DataProvider {
  return new Proxy({} as DataProvider, {
    get(_target, prop: string | symbol) {
      return async (...args: any[]) => {
        const provider = await getProvider();
        const method = (provider as any)[prop];
        if (typeof method === "function") {
          return method.apply(provider, args);
        }
        return method;
      };
    },
  });
}

export const API = createApiProxy();

export { setLocalMode, setServerMode, isLocalModeAsync, onModeChange, resetProvider, getProvider };
