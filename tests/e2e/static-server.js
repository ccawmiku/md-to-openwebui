"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "../..");
const PORT = Number(process.env.PORT || 45173);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  const reqPath = (req.url || "/").split("?")[0];
  const relativePath = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
  const resolved = path.resolve(ROOT_DIR, relativePath);

  if (resolved !== ROOT_DIR && !resolved.startsWith(`${ROOT_DIR}${path.sep}`)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      if (error.code === "ENOENT" && relativePath === "favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(error.code === "ENOENT" ? "Not Found" : "Internal Server Error");
      return;
    }

    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Static server listening at http://127.0.0.1:${PORT}`);
});
