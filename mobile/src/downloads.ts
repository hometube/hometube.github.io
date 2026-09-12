import { API } from "./api";

interface DownloadJob {
  id: string;
  type: "video" | "music";
  item_id: number;
  status: "queued" | "running" | "done" | "error";
  progress?: number;
  error?: string;
}

export async function waitForServerDownload(
  type: "video" | "music",
  itemId: number,
  timeoutMs = 10 * 60 * 1000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const jobs = (await API.get("/downloads", {})) as DownloadJob[];
    const job = (Array.isArray(jobs) ? jobs : []).find(
      (j) => j && j.type === type && Number(j.item_id) === Number(itemId)
    );
    if (job) {
      if (job.status === "done") return;
      if (job.status === "error") throw new Error(job.error || "Download failed");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Download timed out");
}