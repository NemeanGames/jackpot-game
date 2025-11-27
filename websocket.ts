import { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { gameEvents, GameStateUpdate } from "./gameEvents";

let io: SocketIOServer | null = null;

/**
 * Initialize Socket.IO server
 */
export function initializeWebSocket(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    // Subscribe to game tier updates
    socket.on("subscribe:tier", (tier: string) => {
      socket.join(`tier:${tier}`);
      console.log(`[WebSocket] Client ${socket.id} subscribed to tier: ${tier}`);
    });

    // Subscribe to specific game updates
    socket.on("subscribe:game", (gameId: number) => {
      socket.join(`game:${gameId}`);
      console.log(`[WebSocket] Client ${socket.id} subscribed to game: ${gameId}`);
    });

    // Unsubscribe from tier
    socket.on("unsubscribe:tier", (tier: string) => {
      socket.leave(`tier:${tier}`);
      console.log(`[WebSocket] Client ${socket.id} unsubscribed from tier: ${tier}`);
    });

    // Unsubscribe from game
    socket.on("unsubscribe:game", (gameId: number) => {
      socket.leave(`game:${gameId}`);
      console.log(`[WebSocket] Client ${socket.id} unsubscribed from game: ${gameId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });
  });

  // Listen to game events and broadcast to connected clients
  gameEvents.onGameUpdate((update: GameStateUpdate) => {
    if (io) {
      // Broadcast to all clients
      io.emit("gameUpdate", update);

      // Broadcast to tier subscribers
      io.to(`tier:${update.tier}`).emit("tierUpdate", update);

      // Broadcast to game subscribers
      io.to(`game:${update.gameId}`).emit("gameStateChange", update);
    }
  });

  console.log("[WebSocket] Socket.IO server initialized");
  return io;
}

/**
 * Get Socket.IO instance
 */
export function getWebSocket(): SocketIOServer | null {
  return io;
}

/**
 * Broadcast game update to all connected clients
 */
export function broadcastGameUpdate(update: GameStateUpdate) {
  if (io) {
    io.emit("gameUpdate", update);
    io.to(`tier:${update.tier}`).emit("tierUpdate", update);
    io.to(`game:${update.gameId}`).emit("gameStateChange", update);
  }
}
