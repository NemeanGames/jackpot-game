import { getDb } from "./db";
import { userPoints, users, games, gameSlots } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Get or create user points record
 */
export async function getOrCreateUserPoints(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db.select().from(userPoints)
    .where(eq(userPoints.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create new user points record
  await db.insert(userPoints).values({
    userId,
    balance: 30000, // $300 starting balance
    totalEarned: 30000,
    totalWagered: 0,
  });

  return await db.select().from(userPoints)
    .where(eq(userPoints.userId, userId))
    .limit(1)
    .then(r => r[0]);
}

/**
 * Get user points
 */
export async function getUserPoints(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await getOrCreateUserPoints(userId);
}

/**
 * Update user balance
 */
export async function updateUserBalance(userId: number, amount: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await getOrCreateUserPoints(userId);
  const newBalance = current.balance + amount;

  await db.update(userPoints)
    .set({
      balance: newBalance,
      totalEarned: amount > 0 ? current.totalEarned + amount : current.totalEarned,
      totalWagered: amount < 0 ? current.totalWagered + Math.abs(amount) : current.totalWagered,
    })
    .where(eq(userPoints.userId, userId));

  return newBalance;
}

/**
 * Apply daily login reward
 */
export async function applyDailyReward(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const points = await getOrCreateUserPoints(userId);
  const now = new Date();

  // Check if reward was already given today
  if (points.lastDailyReward) {
    const lastReward = new Date(points.lastDailyReward);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastRewardDate = new Date(lastReward.getFullYear(), lastReward.getMonth(), lastReward.getDate());

    if (today.getTime() === lastRewardDate.getTime()) {
      return false; // Already rewarded today
    }
  }

  // Apply $5 reward
  const newBalance = points.balance + 50000; // $500 = 50000 cents

  await db.update(userPoints)
    .set({
      balance: newBalance,
      totalEarned: points.totalEarned + 50000,
      lastDailyReward: now,
    })
    .where(eq(userPoints.userId, userId));

  return true;
}

/**
 * Get user's game history
 */
export async function getUserGameHistory(userId: number, limit: number = 10) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get games where user had slots
  const userSlots = await db.select().from(gameSlots)
    .where(eq(gameSlots.ownerId, userId.toString()));

  const gameIds = Array.from(new Set(userSlots.map(s => s.gameId)));

  if (gameIds.length === 0) return [];

  // Get all games and filter by IDs
  const allGames = await db.select().from(games);
  const gameList = allGames.filter(g => gameIds.includes(g.id))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return gameList.slice(0, limit);
}

/**
 * Get game leaderboard
 */
export async function getLeaderboard(limit: number = 10) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const allPoints = await db.select().from(userPoints);
  return allPoints
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}
