import { useEffect } from "react";
import { usePathname } from "expo-router";
import { useModeStore } from "@/stores/modeStore";

export default function ModeTracker() {
  const pathname = usePathname();
  const setMode = useModeStore((s) => s.setMode);

  useEffect(() => {
    if (pathname.startsWith("/music")) {
      setMode("music");
    } else if (pathname.startsWith("/videos")) {
      setMode("video");
    } else if (pathname.startsWith("/podcasts")) {
      setMode("podcast");
    }
  }, [pathname, setMode]);

  return null;
}