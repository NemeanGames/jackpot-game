import { useEffect, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

export interface GameUpdate {
  gameId: number;
  tier: "low" | "medium" | "high";
  status: "filling" | "full" | "spinning" | "completed";
  filledCount: number;
  slotCount: number;
  slots: Array<{
    slotNumber: number;
    ownerType: "player" | "bot";
    ownerId: string;
  }>;
  result?: {
    winningSlot: number;
    winnerType: "player" | "bot" | "house";
    winnerId: string;
    payout: number;
    houseCommission: number;
  };
}

/**
 * Hook for real-time game state updates via WebSocket
 */
export function useGameWebSocket(tier?: "low" | "medium" | "high") {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameUpdate, setGameUpdate] = useState<GameUpdate | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialize Socket.IO connection
    const newSocket = io(undefined, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    newSocket.on("connect", () => {
      console.log("[WebSocket] Connected");
      setIsConnected(true);

      // Subscribe to tier updates if specified
      if (tier) {
        newSocket.emit("subscribe:tier", tier);
      }
    });

    newSocket.on("disconnect", () => {
      console.log("[WebSocket] Disconnected");
      setIsConnected(false);
    });

    // Listen for game updates
    newSocket.on("gameUpdate", (update: GameUpdate) => {
      console.log("[WebSocket] Received game update:", update);
      setGameUpdate(update);
    });

    newSocket.on("tierUpdate", (update: GameUpdate) => {
      console.log("[WebSocket] Received tier update:", update);
      setGameUpdate(update);
    });

    newSocket.on("gameStateChange", (update: GameUpdate) => {
      console.log("[WebSocket] Received game state change:", update);
      setGameUpdate(update);
    });

    newSocket.on("error", (error) => {
      console.error("[WebSocket] Error:", error);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [tier]);

  const subscribeToTier = useCallback((newTier: "low" | "medium" | "high") => {
    if (socket) {
      socket.emit("subscribe:tier", newTier);
    }
  }, [socket]);

  const subscribeToGame = useCallback((gameId: number) => {
    if (socket) {
      socket.emit("subscribe:game", gameId);
    }
  }, [socket]);

  const unsubscribeFromTier = useCallback((newTier: "low" | "medium" | "high") => {
    if (socket) {
      socket.emit("unsubscribe:tier", newTier);
    }
  }, [socket]);

  const unsubscribeFromGame = useCallback((gameId: number) => {
    if (socket) {
      socket.emit("unsubscribe:game", gameId);
    }
  }, [socket]);

  return {
    socket,
    gameUpdate,
    isConnected,
    subscribeTier: subscribeToTier,
    subscribeGame: subscribeToGame,
    unsubscribeTier: unsubscribeFromTier,
    unsubscribeGame: unsubscribeFromGame,
  };
}
