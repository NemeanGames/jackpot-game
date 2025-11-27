import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { setBotCommands, setBotDescription, getBotInfo } from "./telegram";
import { gameRouter } from "./gameRouters";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  telegram: router({
    initBot: publicProcedure.mutation(async () => {
      try {
        await setBotCommands();
        await setBotDescription();
        const botInfo = await getBotInfo();
        return {
          success: true,
          bot: {
            id: botInfo.id,
            username: botInfo.username,
            first_name: botInfo.first_name,
          },
        };
      } catch (error) {
        console.error("[Telegram] Bot initialization failed:", error);
        throw error;
      }
    }),
  }),
  game: gameRouter,
});

export type AppRouter = typeof appRouter;
