import { describe, expect, it } from "vitest";

describe("Telegram Bot Token Validation", () => {
  it("should validate the Telegram bot token by fetching bot info", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!token) {
      throw new Error("TELEGRAM_BOT_TOKEN environment variable is not set");
    }

    console.log("Token length:", token.length);
    console.log("Token starts with:", token.substring(0, 10));
    
    const url = `https://api.telegram.org/bot${token}/getMe`;
    console.log("API URL (first 50 chars):", url.substring(0, 50));
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log("Error response:", errorText);
      throw new Error(`Telegram API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    expect(data.ok).toBe(true);
    expect(data.result).toBeDefined();
    expect(data.result.is_bot).toBe(true);
    
    console.log("✓ Telegram bot token is valid");
    console.log(`  Bot username: @${data.result.username}`);
    console.log(`  Bot ID: ${data.result.id}`);
  });
});
