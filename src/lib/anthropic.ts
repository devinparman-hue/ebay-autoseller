import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.warn(
    "ANTHROPIC_API_KEY is not set. Vision analysis will fail at runtime."
  );
}

export const anthropic = new Anthropic({
  apiKey: apiKey ?? "missing",
});

export const VISION_MODEL = "claude-opus-4-7";
