import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { version } from "./package.json"
import { resolve } from "node:path"
import { writeServiceWorker } from "./pwa/build"

function pwaServiceWorker(): Plugin {
  let outputDirectory = ""
  return {
    name: "mind-pwa-service-worker",
    configResolved(config) {
      if (config.command === "build") outputDirectory = resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/sw.js") return next()
        response.statusCode = 200
        response.setHeader("Content-Type", "text/javascript; charset=utf-8")
        response.setHeader("Cache-Control", "no-cache")
        response.end(`
const CACHE = "mind-dev-shell";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg", "/pwa-192.png", "/pwa-512.png", "/pwa-maskable-192.png", "/pwa-maskable-512.png"];
const isClerkAsset = url => url.protocol === "https:" && url.pathname.startsWith("/npm/@clerk/clerk-js@") && url.pathname.endsWith(".js");
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  if (event.data?.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter(value => { if (typeof value !== "string") return false; const url = new URL(value, self.location.origin); return url.origin === self.location.origin && !url.pathname.startsWith("/api/") || isClerkAsset(url); });
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(urls.map(url => cache.add(url)))));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const clerkAsset = request.destination === "script" && isClerkAsset(url);
  if (request.method !== "GET" || url.origin !== self.location.origin && !clerkAsset || url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;
  const cacheKey = request.mode === "navigate" ? "/index.html" : request;
  const network = fetch(request).then(async response => {
    if (response.ok || response.type === "opaque") await caches.open(CACHE).then(cache => cache.put(cacheKey, response.clone()));
    return response;
  });
  event.respondWith(caches.match(cacheKey).then(cached => {
    if (!cached) return network;
    event.waitUntil(network.then(() => undefined).catch(() => undefined));
    return cached;
  }));
});`)
      })
    },
    async closeBundle() {
      if (outputDirectory) await writeServiceWorker(outputDirectory)
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react(), pwaServiceWorker()],
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Stable vendor chunks keep the app shell smaller and improve repeat-load caching.
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 50 },
            { name: "vendor-clerk", test: /node_modules[\\/]@clerk[\\/]/, priority: 40 },
            { name: "vendor-cmdk", test: /node_modules[\\/]cmdk[\\/]/, priority: 30 },
            { name: "vendor-dexie", test: /node_modules[\\/]dexie[\\/]/, priority: 30 },
            { name: "vendor-zustand", test: /node_modules[\\/]zustand[\\/]/, priority: 30 },
          ],
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["l13-yoga.tail24a713.ts.net"],
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
})
