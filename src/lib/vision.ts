import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, VISION_MODEL } from "./anthropic";
import type { Draft } from "./types";

const SYSTEM_PROMPT = `You are an eBay listing expert helping a seller list household items quickly and accurately.

For each set of photos, produce a complete listing draft.

TWO AUDIENCES — the most important rule:
- title, description, itemSpecifics, and conditionNotes are BUYER-FACING listing copy. Write them as the seller, holding the item, stating facts. The seller personally verifies and corrects every draft before it posts, so commit to your best reading of the item.
- flags and confidence are SELLER-FACING review notes. ALL of your uncertainty goes there and nowhere else.

GUIDELINES:
- Title: max 80 characters, keyword-dense, front-load the most-searched terms (brand, model, size, type). No clickbait, no ALL-CAPS.
- Description: one tight paragraph, 60–120 words of confident, declarative sales copy. State specs and measurements as plain facts. Describe visible wear honestly and plainly ("light rust on the actuator end", "scuffs on the base") — direct flaw descriptions build buyer trust; hedged ones kill sales. Never write "appears", "seems", "likely", "may", "possibly", "please verify", or "buyer to confirm". Never tell the buyer to check anything with the seller, and never reference the seller or the seller's notes. If a detail can't be determined from the photos, leave it out of the description entirely and flag it instead. Don't invent features you can't see.
- Item specifics: fill the fields eBay indexes (Brand, Model, Color, Size, Material, MPN, etc.) — only fields you can actually determine. State them without qualifiers.
- Condition: judge strictly. Minor scuffs on a used item = "used_good", not "like_new". If you see cracks, stains, missing parts, pick "used_acceptable" or "for_parts".
- Condition notes: buyer-facing. Plain statements of the wear you can see; no hedging, no instructions to the buyer.
- Weight and dimensions: estimate from item type + visible references. Err slightly high so shipping doesn't underquote.
- Size bucket: based on your weight estimate (<1lb, 1-5lb, 5-20lb, 20+lb). For anything clearly too bulky/heavy to ship economically, use "pickup".
- Shipping service: pick one based on size bucket — "USPS Ground Advantage" for <1lb, "USPS Priority Mail" for 1-10lb, "UPS Ground" for 10-50lb, "Local pickup" otherwise.
- Suggested price: median of your mental model of recent sold comps for this exact item + condition. Be realistic, not optimistic.
- Confidence: "high" if you recognize the item clearly; "medium" if brand/model is uncertain; "low" for rare/niche items the seller should research before posting.
- Flags: the ONLY home for doubt. Anything you would otherwise hedge about in the copy becomes a to-verify note for the seller here (e.g., "model number partially obscured — wrote SSH 25610, confirm it", "measure hose length before posting"). Assume the seller resolves every flag before the listing goes live.

Be concise and factual. This listing will be posted as-is unless the user edits it.`;

const LISTING_TOOL: Anthropic.Tool = {
  name: "generate_listing",
  description:
    "Produce a full eBay listing draft from the photos provided. Call this exactly once with the best draft you can generate.",
  input_schema: {
    type: "object",
    required: [
      "title",
      "description",
      "itemSpecifics",
      "condition",
      "conditionNotes",
      "suggestedPrice",
      "estimatedWeightOz",
      "estimatedDimensionsIn",
      "sizeBucket",
      "shippingService",
      "confidence",
      "flags",
    ],
    properties: {
      title: {
        type: "string",
        maxLength: 80,
        description: "eBay title, max 80 chars, keyword-dense.",
      },
      description: {
        type: "string",
        description:
          "Listing body, one paragraph, 60-120 words. Confident declarative " +
          "sales copy — no hedging, no 'buyer to verify' language; " +
          "uncertainty belongs in flags.",
      },
      itemSpecifics: {
        type: "object",
        description:
          "Map of eBay item-specific fields (e.g. Brand, Color, Size, Material). Include only fields you can determine.",
        additionalProperties: { type: "string" },
      },
      condition: {
        type: "string",
        enum: ["new", "like_new", "used_good", "used_acceptable", "for_parts"],
      },
      conditionNotes: {
        type: "string",
        description:
          "Buyer-facing note on visible wear/flaws/marks. Plain statements, " +
          "no hedging.",
      },
      suggestedPrice: {
        type: "number",
        minimum: 0,
        description: "USD price.",
      },
      estimatedWeightOz: {
        type: "number",
        minimum: 0,
        description: "Total shipping weight in ounces.",
      },
      estimatedDimensionsIn: {
        type: "object",
        required: ["l", "w", "h"],
        properties: {
          l: { type: "number", minimum: 0 },
          w: { type: "number", minimum: 0 },
          h: { type: "number", minimum: 0 },
        },
        additionalProperties: false,
      },
      sizeBucket: {
        type: "string",
        enum: ["lt1lb", "1to5lb", "5to20lb", "gt20lb", "pickup"],
      },
      shippingService: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      flags: {
        type: "array",
        items: { type: "string" },
        description:
          "Seller-facing to-verify notes. The ONLY place for uncertainty.",
      },
    },
    additionalProperties: false,
  },
};

export async function analyzePhotos(photoDataUrls: string[]): Promise<Draft> {
  const imageBlocks = photoDataUrls.map((dataUrl) => {
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) throw new Error("Invalid photo data URL");
    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: match[1] as
          | "image/jpeg"
          | "image/png"
          | "image/webp"
          | "image/gif",
        data: match[2],
      },
    };
  });

  const response = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [LISTING_TOOL],
    tool_choice: { type: "tool", name: LISTING_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: "Generate the listing draft for these photos.",
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a listing draft");
  }

  return toolUse.input as Draft;
}
