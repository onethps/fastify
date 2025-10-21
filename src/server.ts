import Fastify from "fastify";
import fastifyIO from "fastify-socket.io";
import { SERVER_CONFIG, LOG_LEVEL, SERVER_INFO } from "./config.js";

export async function createServer() {
  const server = Fastify({
    logger: {
      level: LOG_LEVEL,
    },
  });

  await server.register(fastifyIO, {
    cors: SERVER_CONFIG.cors,
  });

  return server;
}

export function setupRoutes(server: any, activeUsers: Map<string, any>) {
  server.get("/", async () => ({
    status: "healthy",
    message: "Socket.IO server is running",
    activeConnections: activeUsers.size,
    timestamp: new Date().toISOString(),
  }));

  server.get("/info", async () => ({
    server: SERVER_INFO.name,
    version: SERVER_INFO.version,
    activeUsers: activeUsers.size,
    uptime: process.uptime(),
  }));
}

export async function startServer(server: any) {
  await server.listen({
    port: SERVER_CONFIG.port,
    host: SERVER_CONFIG.host,
  });

  console.log(
    `🚀 Server running on http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`
  );
}
