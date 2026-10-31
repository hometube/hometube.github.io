// HomeTube JS server entry (Bun). Mirrors backend/main.py startup:
// tool-path widening, schema init, JWT secret, boot pairing token, banner.
import { createApp } from "./app";
import { openDb } from "./db";
import { ensureToolPath } from "./paths";
import { getJwtSecret, issuePairingToken } from "./auth";
import { startWatchdogs } from "./watchdog";
import { registerCore } from "./routes/core";
import { lanIp } from "./auth";

ensureToolPath();
const db = openDb();
startWatchdogs((s) => console.log(s));

const app = createApp();
registerCore(app);

const port = Number(process.env.PORT ?? 8000);

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  fetch(req, srv) {
    const remoteIp = srv.requestIP(req)?.address ?? "";
    return app.fetch(req, { remoteIp, db });
  },
});

getJwtSecret(db);
const { token: bootToken, ttl } = issuePairingToken(db);

console.log("\n" + "=".repeat(60));
console.log("🚀 HomeTube Server Ready! (JS/Bun)");
console.log("=".repeat(60));
console.log(`Local API:     http://localhost:${port}`);
console.log(`Network:       http://${lanIp()}:${port}`);
console.log("");
console.log(`📱 One-time pairing token (valid ${Math.trunc(ttl / 60)} min):`);
console.log(`   ${bootToken}`);
