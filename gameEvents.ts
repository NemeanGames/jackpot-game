import { EventEmitter } from "events";

export interface GameStateUpdate {
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

class GameEventEmitter extends EventEmitter {
  private static instance: GameEventEmitter;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): GameEventEmitter {
    if (!GameEventEmitter.instance) {
      GameEventEmitter.instance = new GameEventEmitter();
    }
    return GameEventEmitter.instance;
  }

  /**
   * Emit game state update
   */
  public emitGameUpdate(update: GameStateUpdate) {
    this.emit("gameUpdate", update);
    this.emit(`game:${update.gameId}`, update);
    this.emit(`tier:${update.tier}`, update);
  }

  /**
   * Subscribe to all game updates
   */
  public onGameUpdate(callback: (update: GameStateUpdate) => void) {
    this.on("gameUpdate", callback);
  }

  /**
   * Subscribe to specific game updates
   */
  public onGameStateChange(gameId: number, callback: (update: GameStateUpdate) => void) {
    this.on(`game:${gameId}`, callback);
  }

  /**
   * Subscribe to tier updates
   */
  public onTierUpdate(tier: "low" | "medium" | "high", callback: (update: GameStateUpdate) => void) {
    this.on(`tier:${tier}`, callback);
  }

  /**
   * Unsubscribe from game updates
   */
  public offGameUpdate(callback: (update: GameStateUpdate) => void) {
    this.off("gameUpdate", callback);
  }

  /**
   * Unsubscribe from specific game updates
   */
  public offGameStateChange(gameId: number, callback: (update: GameStateUpdate) => void) {
    this.off(`game:${gameId}`, callback);
  }
}

export const gameEvents = GameEventEmitter.getInstance();
