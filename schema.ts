import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Games table - tracks all wheel spins
 */
export const games = mysqlTable("games", {
  id: int("id").autoincrement().primaryKey(),
  tier: mysqlEnum("tier", ["low", "medium", "high"]).notNull(),
  slotCount: int("slotCount").notNull(),
  entryCost: int("entryCost").notNull(),
  edgePct: int("edgePct").notNull(),
  winningSlot: int("winningSlot"),
  winnerType: mysqlEnum("winnerType", ["player", "bot", "house"]),
  winnerId: varchar("winnerId", { length: 64 }),
  payout: int("payout"),
  houseCommission: int("houseCommission"),
  status: mysqlEnum("status", ["filling", "full", "spinning", "completed"]).default("filling").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type Game = typeof games.$inferSelect;
export type InsertGame = typeof games.$inferInsert;

/**
 * Game slots table - tracks who owns each slot in a game
 */
export const gameSlots = mysqlTable("gameSlots", {
  id: int("id").autoincrement().primaryKey(),
  gameId: int("gameId").notNull(),
  slotNumber: int("slotNumber").notNull(),
  ownerType: mysqlEnum("ownerType", ["player", "bot"]).notNull(),
  ownerId: varchar("ownerId", { length: 64 }).notNull(),
  entryCost: int("entryCost").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GameSlot = typeof gameSlots.$inferSelect;
export type InsertGameSlot = typeof gameSlots.$inferInsert;

/**
 * User points table - tracks player balance
 */
export const userPoints = mysqlTable("userPoints", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  balance: int("balance").default(30000).notNull(),
  totalEarned: int("totalEarned").default(0).notNull(),
  totalWagered: int("totalWagered").default(0).notNull(),
  lastDailyReward: timestamp("lastDailyReward"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPoints = typeof userPoints.$inferSelect;
export type InsertUserPoints = typeof userPoints.$inferInsert;
