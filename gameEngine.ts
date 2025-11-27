import { getDb } from "./db";
import { games, gameSlots } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";
import { gameEvents } from "./gameEvents";
import { updateUserBalance } from "./gameDb";

const BOT_NAMES = ["T", "B", "J", "P", "K", "M", "S", "L", "R", "N", "C", "D"];

interface GameConfig {
  tier: "low" | "medium" | "high";
  slotCount: number;
  entryCost: number;
  edgePct: number;
  fillTimeMs: number; // Time in ms to fill the wheel
}

const GAME_CONFIGS: Record<string, GameConfig> = {
  low: { tier: "low", slotCount: 12, entryCost: 5, edgePct: -2, fillTimeMs: 30000 },
  medium: { tier: "medium", slotCount: 10, entryCost: 11, edgePct: -8, fillTimeMs: 30000 },
  high: { tier: "high", slotCount: 6, entryCost: 25, edgePct: -20, fillTimeMs: 15000 },
};

export async function createGame(tier: "low" | "medium" | "high"): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const config = GAME_CONFIGS[tier];
  const result = await db.insert(games).values({
    tier: config.tier,
    slotCount: config.slotCount,
    entryCost: config.entryCost,
    edgePct: config.edgePct,
    status: "filling",
  });

  console.log(`[Game Engine] Created new ${tier} game (ID: ${result[0].insertId}, slots: ${config.slotCount}, fill time: ${config.fillTimeMs}ms)`);
  return result[0].insertId;
}

export async function getGameState(gameId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    const gameData = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!gameData.length) return null;

    const game = gameData[0];
    const slots = await db.select().from(gameSlots).where(eq(gameSlots.gameId, gameId));

    return {
      game,
      slots,
      filledCount: slots.length,
      emptyCount: game.slotCount - slots.length,
    };
  } catch (error) {
    console.error("[Game Engine] Error getting game state:", error);
    return null;
  }
}

export async function addBotEntry(gameId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const state = await getGameState(gameId);
  if (!state || state.game.status !== "filling") {
    console.log(`[Game Engine] Cannot add bot to game ${gameId}: game not in filling state`);
    return false;
  }

  if (state.filledCount >= state.game.slotCount) {
    console.log(`[Game Engine] Cannot add bot to game ${gameId}: board already full (${state.filledCount}/${state.game.slotCount})`);
    return false;
  }

  const occupiedSlots = new Set(state.slots.map(s => s.slotNumber));

  let emptySlot: number | null = null;
  for (let i = 1; i <= state.game.slotCount; i++) {
    if (!occupiedSlots.has(i)) {
      emptySlot = i;
      break;
    }
  }

  if (!emptySlot) {
    console.log(`[Game Engine] No empty slots found for game ${gameId}`);
    return false;
  }

  const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

  await db.insert(gameSlots).values({
    gameId,
    slotNumber: emptySlot,
    ownerType: "bot",
    ownerId: botName,
    entryCost: state.game.entryCost,
  });

  console.log(`[Game Engine] Bot ${botName} joined game ${gameId} on slot ${emptySlot} (${state.filledCount + 1}/${state.game.slotCount})`);
  return true;
}

export async function checkAndSpinIfFull(gameId: number): Promise<boolean> {
  const state = await getGameState(gameId);
  if (!state) return false;

  if (state.filledCount < state.game.slotCount) {
    console.log(`[Game Engine] Game ${gameId} not full yet (${state.filledCount}/${state.game.slotCount})`);
    return false;
  }

  console.log(`[Game Engine] Game ${gameId} is full! Spinning now...`);
  return await spinGame(gameId);
}

export async function spinGame(gameId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const state = await getGameState(gameId);
  if (!state) return false;

  // Mark game as spinning
  await db.update(games).set({ status: "spinning" }).where(eq(games.id, gameId));
  console.log(`[Game Engine] Game ${gameId} spinning...`);

  // Determine a random winning slot
  const winningSlot = Math.floor(Math.random() * state.game.slotCount) + 1;
  const winnerSlot = state.slots.find(s => s.slotNumber === winningSlot);

  let winnerType: "player" | "bot" | "house" = "house";
  let winnerId = "house";
  let payout = 0;

  if (winnerSlot) {
    winnerType = winnerSlot.ownerType as "player" | "bot";
    winnerId = winnerSlot.ownerId;

    // Calculate payout only if a player won
    const playerSlots = state.slots.filter(s => s.ownerType === "player").length;
    if (playerSlots > 0 && winnerType === "player") {
      const playerWinChance = playerSlots / state.game.slotCount;
      const totalPot = state.slots.length * state.game.entryCost;
      const rawPayout = (totalPot / playerWinChance) * (1 + state.game.edgePct / 100);
      payout = Math.round(rawPayout / 5) * 5;
    }
  }

  // Calculate house commission (10% of total pot)
  const totalPot = state.slots.length * state.game.entryCost;
  const houseCommission = Math.round(totalPot * 0.1);

  // Finalize game results in database
  await db.update(games).set({
    winningSlot,
    winnerType,
    winnerId,
    payout: winnerType === "player" ? payout : 0,
    houseCommission,
    status: "completed",
    completedAt: new Date(),
  }).where(eq(games.id, gameId));

  console.log(`[Game Engine] Game ${gameId} completed: Slot ${winningSlot} (${winnerType} ${winnerId}) won ${payout} points, house took ${houseCommission}`);

  // If a player won, credit their points balance with the payout
  if (winnerType === "player") {
    const userId_num = parseInt(winnerId);
    if (!isNaN(userId_num)) {
      await updateUserBalance(userId_num, payout);
      console.log(`[Game Engine] Credited ${payout} points to player ${winnerId}`);
    } else {
      console.error("[Game Engine] Cannot update balance, invalid winnerId:", winnerId);
    }
  }

  // Emit final game state update for clients
  const finalState = await getGameState(gameId);
  if (finalState) {
    gameEvents.emitGameUpdate({
      gameId: finalState.game.id,
      tier: finalState.game.tier,
      status: finalState.game.status as any,
      filledCount: finalState.filledCount,
      slotCount: finalState.game.slotCount,
      slots: finalState.slots.map(s => ({
        slotNumber: s.slotNumber,
        ownerType: s.ownerType as any,
        ownerId: s.ownerId,
      })),
      result: {
        winningSlot,
        winnerType,
        winnerId,
        payout,
        houseCommission,
      },
    });
  }

  return true;
}

export async function getOrCreateActiveGame(tier: "low" | "medium" | "high"): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    // Find an active game (filling or full) for the tier
    const activeGames = await db.select().from(games)
      .where(and(
        eq(games.tier, tier),
        inArray(games.status, ["filling", "full"])
      ))
      .limit(1);

    if (activeGames.length > 0) {
      console.log(`[Game Engine] Found active game ${activeGames[0].id} for ${tier} tier`);
      return activeGames[0].id;
    }

    // Otherwise, create a new game for this tier
    console.log(`[Game Engine] No active game for ${tier} tier, creating new one`);
    return await createGame(tier);
  } catch (error) {
    console.error(`[Game Engine] Error getting or creating active game for ${tier}:`, error);
    throw error;
  }
}

export async function startAutonomousGameLoop() {
  console.log("[Game Engine] Starting autonomous game loop...");

  const tiers: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

  for (const tier of tiers) {
    startGameLoopForTier(tier);
  }
}

function startGameLoopForTier(tier: "low" | "medium" | "high") {
  const config = GAME_CONFIGS[tier];
  const fillTimeMs = config.fillTimeMs;
  const slotCount = config.slotCount;

  console.log(`[Game Engine] Starting ${tier} tier loop (fill time: ${fillTimeMs}ms, slots: ${slotCount})`);

  setInterval(async () => {
    try {
      const gameId = await getOrCreateActiveGame(tier);
      const state = await getGameState(gameId);

      if (!state) {
        console.log(`[Game Engine] ${tier}: Could not get game state for game ${gameId}`);
        return;
      }

      console.log(`[Game Engine] ${tier} game ${gameId}: ${state.filledCount}/${state.game.slotCount} slots filled, status: ${state.game.status}`);

      // If game is already full, spin it
      if (state.filledCount >= state.game.slotCount) {
        console.log(`[Game Engine] ${tier} game ${gameId} is full, spinning now`);
        await checkAndSpinIfFull(gameId);
        return;
      }

      // Calculate how many bots to add to fill the wheel within fillTimeMs
      const emptySlots = state.game.slotCount - state.filledCount;
      const botsToAdd = Math.max(1, Math.ceil(emptySlots / 3)); // Add 1-3 bots per interval

      console.log(`[Game Engine] ${tier} game ${gameId}: Adding ${botsToAdd} bots to fill ${emptySlots} empty slots`);

      for (let i = 0; i < botsToAdd; i++) {
        const added = await addBotEntry(gameId);
        if (added) {
          const updatedState = await getGameState(gameId);
          if (updatedState) {
            gameEvents.emitGameUpdate({
              gameId: updatedState.game.id,
              tier: updatedState.game.tier,
              status: updatedState.game.status as any,
              filledCount: updatedState.filledCount,
              slotCount: updatedState.game.slotCount,
              slots: updatedState.slots.map(s => ({
                slotNumber: s.slotNumber,
                ownerType: s.ownerType as any,
                ownerId: s.ownerId,
              })),
            });

            // Check if wheel is now full and spin immediately
            if (updatedState.filledCount >= updatedState.game.slotCount) {
              console.log(`[Game Engine] ${tier} game ${gameId} is now full after bot entry, spinning immediately`);
              await checkAndSpinIfFull(gameId);
              return;
            }
          }
        }
      }
    } catch (error) {
      console.error(`[Game Engine] Error in ${tier} tier loop:`, error);
    }
  }, fillTimeMs);

  console.log(`[Game Engine] ${tier} tier loop started with ${fillTimeMs}ms interval`);
}
