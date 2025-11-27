import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getOrCreateActiveGame, getGameState, addBotEntry, checkAndSpinIfFull } from "./gameEngine";
import { getOrCreateUserPoints, applyDailyReward, getUserPoints, updateUserBalance } from "./gameDb";

export const gameRouter = router({
  /**
   * Get current active game state for a tier
   */
  getActiveGame: publicProcedure
    .input(z.object({ tier: z.enum(["low", "medium", "high"]) }))
    .query(async ({ input }) => {
      try {
        const gameId = await getOrCreateActiveGame(input.tier);
        const state = await getGameState(gameId);
        
        if (!state) {
          return { error: "Game not found" };
        }

        return {
          gameId: state.game.id,
          tier: state.game.tier,
          slotCount: state.game.slotCount,
          entryCost: state.game.entryCost,
          edgePct: state.game.edgePct,
          status: state.game.status,
          filledCount: state.filledCount,
          emptyCount: state.emptyCount,
          slots: state.slots.map(s => ({
            slotNumber: s.slotNumber,
            ownerType: s.ownerType,
            ownerId: s.ownerId,
          })),
          result: state.game.winningSlot ? {
            winningSlot: state.game.winningSlot,
            winnerType: state.game.winnerType,
            winnerId: state.game.winnerId,
            payout: state.game.payout,
          } : null,
        };
      } catch (error) {
        console.error("[Game Router] Error getting active game:", error);
        throw error;
      }
    }),

  /**
   * Get user's points balance
   */
  getUserBalance: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const points = await getUserPoints(ctx.user.id);
        return {
          balance: points.balance,
          totalEarned: points.totalEarned,
          totalWagered: points.totalWagered,
          lastDailyReward: points.lastDailyReward,
        };
      } catch (error) {
        console.error("[Game Router] Error getting user balance:", error);
        throw error;
      }
    }),

  /**
   * Claim daily login reward
   */
  claimDailyReward: protectedProcedure
    .mutation(async ({ ctx }) => {
      try {
        const success = await applyDailyReward(ctx.user.id);
        if (success) {
          const points = await getUserPoints(ctx.user.id);
          return {
            success: true,
            message: "Daily reward claimed!",
            newBalance: points.balance,
          };
        } else {
          return {
            success: false,
            message: "Daily reward already claimed today",
          };
        }
      } catch (error) {
        console.error("[Game Router] Error claiming daily reward:", error);
        throw error;
      }
    }),

  /**
   * Buy a spot on the wheel (player entry)
   */
  buySpot: protectedProcedure
    .input(z.object({
      gameId: z.number(),
      slotNumber: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const state = await getGameState(input.gameId);
        if (!state) {
          throw new Error("Game not found");
        }

        // Check if slot is available
        const slotTaken = state.slots.some(s => s.slotNumber === input.slotNumber);
        if (slotTaken) {
          throw new Error("Slot already taken");
        }

        // Check user balance
        const userPoints = await getUserPoints(ctx.user.id);
        if (userPoints.balance < state.game.entryCost) {
          throw new Error("Insufficient balance");
        }

        // Deduct cost from balance
        await updateUserBalance(ctx.user.id, -state.game.entryCost);

        // Add player entry to game
        const db = await (await import("./db")).getDb();
        if (!db) throw new Error("Database not available");

        const { gameSlots } = await import("../drizzle/schema");
        await db.insert(gameSlots).values({
          gameId: input.gameId,
          slotNumber: input.slotNumber,
          ownerType: "player",
          ownerId: ctx.user.id.toString(),
          entryCost: state.game.entryCost,
        });

        // Check if game is now full and spin if needed
        await checkAndSpinIfFull(input.gameId);

        return {
          success: true,
          message: "Spot purchased!",
          newBalance: userPoints.balance - state.game.entryCost,
        };
      } catch (error) {
        console.error("[Game Router] Error buying spot:", error);
        throw error;
      }
    }),
});
