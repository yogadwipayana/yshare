import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import next from "next";
import QRCode from "qrcode";
import { ConfigError, loadConfig } from "./src/lib/config";
import { getLanAddresses, isAllowedHost, isPrivateIp, isSameOriginRequest, normalizeIp } from "./src/lib/network";
import { initState } from "./src/lib/state";
import { cleanupLeftoverTemps, removeActiveTempsSync } from "./src/lib/temp";
import { cleanupStaleSessions } from "./src/lib/upload";

const dev = process.env.NODE_ENV !== "production";

const color = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
};

function reject(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" });
  res.end(message);
}

async function main() {
  let loaded;
  try {
    loaded = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(color.red(`\n✖ ${err.message}\n`));
      process.exit(1);
    }
    throw err;
  }
  const { config, warnings } = loaded;
  const state = initState(config);
  const removed = cleanupLeftoverTemps();
  const { host, port, lanOnly, allowedHosts } = config.server;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const ip = normalizeIp(req.socket.remoteAddress);

    if (lanOnly && !isPrivateIp(ip)) {
      console.warn(`[guard] ditolak (bukan IP lokal): ${ip} ${req.method} ${req.url}`);
      return reject(res, 403, "yshare hanya bisa diakses dari jaringan lokal.");
    }
    if (!isAllowedHost(req.headers.host, allowedHosts)) {
      console.warn(`[guard] ditolak (Host tidak dikenal): ${req.headers.host} dari ${ip}`);
      return reject(res, 421, "Alamat host tidak dikenal. Buka yshare memakai alamat IP-nya.");
    }
    if (!isSameOriginRequest(req.method, req.headers)) {
      console.warn(`[guard] ditolak (permintaan lintas situs): ${req.headers.origin} dari ${ip}`);
      return reject(res, 403, "Permintaan dari situs lain ditolak.");
    }

    // Route handlers read the client IP from here. Overwrite whatever the client sent.
    req.headers["x-yshare-ip"] = ip;
    // `handle` is assigned below, before the server starts listening.
    void handle(req, res);
  });

  // Node closes requests after 5 minutes by default, which would cut off large uploads.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  // Next.js handles the dev-mode HMR websocket on the same server; keep strangers out of it too.
  server.prependListener("upgrade", (req, socket) => {
    const ip = normalizeIp(req.socket.remoteAddress);
    if ((lanOnly && !isPrivateIp(ip)) || !isAllowedHost(req.headers.host, allowedHosts)) socket.destroy();
  });

  const app = next({ dev, hostname: "localhost", port, httpServer: server });
  await app.prepare();
  const handle = app.getRequestHandler();

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(color.red(`\n✖ Port ${port} sudah dipakai program lain. Ganti server.port di yshare.config.yaml.\n`));
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  server.listen(port, host, async () => {
    const lan = host === "127.0.0.1" || host === "localhost" ? [] : getLanAddresses();
    const linkFor = (address: string) =>
      config.auth.enabled ? `http://${address}:${port}/t/${state.token}` : `http://${address}:${port}/`;

    console.log("");
    console.log(color.green(color.bold("  yshare siap")) + color.dim(`  (${dev ? "development" : "production"})`));
    console.log("");

    if (lan.length > 0) {
      console.log("  Buka dari HP/laptop yang tersambung ke Wi-Fi/LAN yang sama:");
      console.log(`    ${color.cyan(linkFor(lan[0].address))}`);
      for (const extra of lan.slice(1)) {
        console.log(color.dim(`    atau ${linkFor(extra.address)}  (${extra.interface})`));
      }
      console.log("");
      const qr = await QRCode.toString(linkFor(lan[0].address), { type: "terminal", small: true });
      console.log(qr.replace(/^/gm, "    "));
    } else {
      console.log(color.yellow("  ⚠ Tidak ada IP LAN yang terdeteksi. Pastikan PC ini tersambung ke Wi-Fi/LAN."));
      console.log("");
    }

    if (config.auth.enabled) {
      console.log(`  PIN (jika mengetik alamat tanpa token): ${color.bold(state.pin)}`);
    } else {
      console.log(color.yellow("  ⚠ Login dimatikan (auth.enabled: false). Semua perangkat di jaringan ini bisa upload."));
    }
    console.log(color.dim(`  Di PC ini: ${linkFor("localhost")}`));
    console.log("");

    console.log("  Folder yang diizinkan:");
    for (const root of config.roots) console.log(`    • ${root.name}  ${color.dim(root.realPath)}`);
    for (const warning of warnings) console.log(color.yellow(`    ⚠ ${warning}`));
    console.log("");

    if (removed > 0) console.log(color.dim(`  Membersihkan ${removed} file sementara dari upload yang terputus.`));
    if (!lanOnly) console.log(color.yellow("  ⚠ server.lan_only: false — request dari luar jaringan lokal tidak ditolak."));
    if (process.platform === "win32") {
      console.log(color.dim('  Windows Firewall: izinkan Node.js hanya untuk jaringan "Private", jangan "Public".'));
    }
    console.log(color.dim("  Tekan Ctrl+C untuk berhenti."));
    console.log("");
  });

  // Unfinished uploads stay resumable for 24 hours, then their partial files are deleted.
  setInterval(() => void cleanupStaleSessions().catch((err) => console.error(err)), 10 * 60 * 1000).unref();

  const shutdown = () => {
    removeActiveTempsSync();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
