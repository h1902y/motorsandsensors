import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { ZipArchive } from "archiver";
import type {
  DeleteRequest,
  EntryKind,
  FsEntry,
  ListResponse,
  MkdirRequest,
  OpenRequest,
  RenameRequest,
} from "@webcode/protocol";
import { PathError, resolveSafe, toRel } from "./safe-path.js";

const STAT_CONCURRENCY = 64;

const MIME: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".js": "text/javascript",
  ".ts": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

function kindOf(dirent: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): EntryKind {
  if (dirent.isSymbolicLink()) return "symlink";
  if (dirent.isDirectory()) return "dir";
  if (dirent.isFile()) return "file";
  return "other";
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createFsApi(root: string): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof PathError) return c.json({ error: err.message }, 403);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return c.json({ error: "not found" }, 404);
    if (code === "EEXIST") return c.json({ error: "already exists" }, 409);
    console.error("[fs-api]", err);
    return c.json({ error: "internal error" }, 500);
  });

  app.get("/list", async (c) => {
    const abs = await resolveSafe(root, c.req.query("path") ?? "");
    const dirents = await fsp.readdir(abs, { withFileTypes: true });
    const entries = await mapLimit(dirents, STAT_CONCURRENCY, async (d): Promise<FsEntry> => {
      const full = path.join(abs, d.name);
      const kind = kindOf(d);
      let size = 0;
      let mtimeMs = 0;
      let targetKind: EntryKind | undefined;
      try {
        const lst = await fsp.lstat(full);
        size = lst.size;
        mtimeMs = lst.mtimeMs;
        if (kind === "symlink") {
          // Only report a resolvable target if it stays inside the workspace.
          await resolveSafe(root, toRel(root, full));
          const st = await fsp.stat(full);
          targetKind = st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
        }
      } catch {
        // broken symlink / vanished entry — report what we know
      }
      return { name: d.name, kind, targetKind, size, mtimeMs };
    });
    entries.sort((a, b) => {
      const aDir = a.kind === "dir" || a.targetKind === "dir" ? 0 : 1;
      const bDir = b.kind === "dir" || b.targetKind === "dir" ? 0 : 1;
      return aDir - bDir || a.name.localeCompare(b.name);
    });
    const body: ListResponse = { path: toRel(root, abs), entries };
    return c.json(body);
  });

  app.post("/mkdir", async (c) => {
    const body = await c.req.json<MkdirRequest>();
    const abs = await resolveSafe(root, body.path ?? "");
    if (abs === root) return c.json({ error: "invalid path" }, 400);
    await fsp.mkdir(abs, { recursive: true });
    return c.json({ ok: true });
  });

  app.post("/rename", async (c) => {
    const body = await c.req.json<RenameRequest>();
    const from = await resolveSafe(root, body.from ?? "");
    const to = await resolveSafe(root, body.to ?? "");
    if (from === root || to === root) return c.json({ error: "invalid path" }, 400);
    await fsp.rename(from, to);
    return c.json({ ok: true });
  });

  app.post("/delete", async (c) => {
    const body = await c.req.json<DeleteRequest>();
    if (!Array.isArray(body.paths) || body.paths.length === 0) {
      return c.json({ error: "paths required" }, 400);
    }
    for (const p of body.paths) {
      const abs = await resolveSafe(root, p);
      if (abs === root) return c.json({ error: "cannot delete workspace root" }, 400);
      await fsp.rm(abs, { recursive: true, force: true });
    }
    return c.json({ ok: true });
  });

  app.get("/download", async (c) => {
    const abs = await resolveSafe(root, c.req.query("path") ?? "");
    const st = await fsp.stat(abs);
    const name = path.basename(abs) || "workspace";

    if (st.isDirectory()) {
      // store-only zip: local transfer, no point burning CPU on deflate
      const archive = new ZipArchive({ store: true });
      archive.on("error", (err: Error) => console.error("[zip]", err));
      archive.directory(abs, name);
      void archive.finalize();
      return new Response(Readable.toWeb(archive) as ReadableStream, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}.zip`,
        },
      });
    }

    const range = c.req.header("range");
    const headers: Record<string, string> = {
      "Content-Type": contentType(abs),
      "Accept-Ranges": "bytes",
      "Content-Disposition":
        c.req.query("inline") === "1"
          ? "inline"
          : `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    };
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : st.size - Number(match[2]);
      const end = match[1] && match[2] ? Math.min(Number(match[2]), st.size - 1) : st.size - 1;
      if (Number.isNaN(start) || start < 0 || start > end) {
        return c.body(null, 416, { "Content-Range": `bytes */${st.size}` });
      }
      headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
      headers["Content-Length"] = String(end - start + 1);
      const stream = Readable.toWeb(fs.createReadStream(abs, { start, end })) as ReadableStream;
      return new Response(stream, { status: 206, headers });
    }
    headers["Content-Length"] = String(st.size);
    return new Response(Readable.toWeb(fs.createReadStream(abs)) as ReadableStream, { headers });
  });

  // Open with the OS default app, or reveal in the system file manager —
  // the local-native replacement for download/upload.
  app.post("/open", async (c) => {
    const body = await c.req.json<OpenRequest>();
    const abs = await resolveSafe(root, body.path ?? "");
    await fsp.access(abs); // 404 if missing
    let cmd: string;
    let args: string[];
    if (process.platform === "darwin") {
      cmd = "open";
      args = body.reveal ? ["-R", abs] : [abs];
    } else if (process.platform === "win32") {
      cmd = "explorer";
      args = body.reveal ? [`/select,${abs}`] : [abs];
    } else {
      cmd = "xdg-open";
      args = [body.reveal ? path.dirname(abs) : abs];
    }
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
    return c.json({ ok: true });
  });

  return app;
}
