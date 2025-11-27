import { ENV } from "./_core/env";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const BOT_TOKEN = ENV.telegramBotToken;
const GAME_URL = "https://3000-i6e6nw4r9blrvv5cwt1c8-352ba4bd.manusvm.computer";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
      first_name?: string;
    };
    date: number;
    text?: string;
  };
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: {
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
    reply_markup?: any;
  }
): Promise<void> {
  const url = `${TELEGRAM_API_BASE}/bot${BOT_TOKEN}/sendMessage`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options?.parse_mode || "HTML",
      reply_markup: options?.reply_markup,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[Telegram] Send message failed:", error);
    throw new Error(`Telegram API error: ${response.status}`);
  }
}

/**
 * Set bot commands
 */
export async function setBotCommands(): Promise<void> {
  const url = `${TELEGRAM_API_BASE}/bot${BOT_TOKEN}/setMyCommands`;
  
  const commands = [
    {
      command: "start",
      description: "Start the bot and get game link",
    },
    {
      command: "play",
      description: "Open the Jackpot game",
    },
    {
      command: "help",
      description: "Get help and instructions",
    },
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[Telegram] Set commands failed:", error);
    throw new Error(`Telegram API error: ${response.status}`);
  }

  console.log("[Telegram] Bot commands set successfully");
}

/**
 * Set bot description and about section
 */
export async function setBotDescription(): Promise<void> {
  const url = `${TELEGRAM_API_BASE}/bot${BOT_TOKEN}/setMyDescription`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "🎡 Reward Wheel Jackpot Game - Spin the wheel, win big! Buy spots, compete with bots, and test your luck.",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[Telegram] Set description failed:", error);
    throw new Error(`Telegram API error: ${response.status}`);
  }

  console.log("[Telegram] Bot description set successfully");
}

/**
 * Handle incoming Telegram updates
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.toLowerCase().trim();
  const userName = message.from.first_name || "Player";

  if (text === "/start") {
    const welcomeText = `
<b>🎡 Welcome to Reward Wheel Jackpot!</b>

Hi <b>${userName}</b>! 👋

This is an autonomous gambling game where you can:
• Buy spots on a spinning wheel
• Compete with AI bots
• Win big with the right luck

<b>Commands:</b>
/play - Open the game
/help - Get more information

Ready to spin? Click the button below or use /play!
    `.trim();

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: "🎮 Play Game",
            url: GAME_URL,
          },
        ],
      ],
    };

    await sendTelegramMessage(chatId, welcomeText, {
      reply_markup: inlineKeyboard,
    });
  } else if (text === "/play") {
    const playText = `
<b>🎮 Let's Play!</b>

Click the button below to open the Jackpot Game:
    `.trim();

    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: "🎡 Open Game",
            url: GAME_URL,
          },
        ],
      ],
    };

    await sendTelegramMessage(chatId, playText, {
      reply_markup: inlineKeyboard,
    });
  } else if (text === "/help") {
    const helpText = `
<b>📖 How to Play</b>

<b>Game Rules:</b>
1. The wheel has 10 slots (or 12/6 depending on risk tier)
2. Buy spots on the wheel with your points
3. Bots will fill remaining spots
4. When the wheel is full, it spins automatically
5. Winner takes the pot!

<b>Risk Tiers:</b>
• <b>Low Risk:</b> 12 slots, $0.05 per spot
• <b>Medium Risk:</b> 10 slots, $0.11 per spot
• <b>High Risk:</b> 6 slots, $0.25 per spot

<b>Daily Rewards:</b>
Login daily to earn $5 bonus points!

<b>Commands:</b>
/start - Welcome message
/play - Open the game
/help - This message

Ready to play? Use /play to get started!
    `.trim();

    await sendTelegramMessage(chatId, helpText);
  } else {
    const responseText = `
Hi ${userName}! 👋

I'm the Reward Wheel Jackpot bot. Here's what I can do:

/start - Welcome & game overview
/play - Open the game
/help - Game instructions

Type any of these commands to get started!
    `.trim();

    await sendTelegramMessage(chatId, responseText);
  }
}

/**
 * Get bot info to verify token is valid
 */
export async function getBotInfo(): Promise<any> {
  const url = `${TELEGRAM_API_BASE}/bot${BOT_TOKEN}/getMe`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }

  const data = await response.json();
  return data.result;
}
