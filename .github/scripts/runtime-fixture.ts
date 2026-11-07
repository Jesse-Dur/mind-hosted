const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => Response.json({ bun: Bun.version }),
})
await Bun.write(Bun.argv[2]!, String(server.port))
process.on("SIGTERM", () => { server.stop(true); process.exit(0) })
