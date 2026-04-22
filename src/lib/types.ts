export type ConditionGrade =
  | "new"
  | "like_new"
  | "used_good"
  | "used_acceptable"
  | "for_parts";

export const CONDITION_LABELS: Record<ConditionGrade, string> = {
  new: "New",
  like_new: "Like New",
  used_good: "Good — used",
  used_acceptable: "Acceptable — used",
  for_parts: "For parts / not working",
};

export type SizeBucket = "lt1lb" | "1to5lb" | "5to20lb" | "gt20lb" | "pickup";

export const SIZE_BUCKET_LABELS: Record<SizeBucket, string> = {
  lt1lb: "< 1 lb",
  "1to5lb": "1–5 lb",
  "5to20lb": "5–20 lb",
  gt20lb: "20+ lb",
  pickup: "Local pickup only",
};

export type ListingStatus = "draft" | "active" | "sold" | "unsold";

export interface Draft {
  title: string;
  description: string;
  itemSpecifics: Record<string, string>;
  condition: ConditionGrade;
  conditionNotes: string;
  suggestedPrice: number;
  estimatedWeightOz: number;
  estimatedDimensionsIn: { l: number; w: number; h: number };
  sizeBucket: SizeBucket;
  shippingService: string;
  confidence: "high" | "medium" | "low";
  flags: string[];
}

export interface Listing extends Draft {
  id: string;
  status: ListingStatus;
  photos: string[];
  createdAt: string;
  postedAt?: string;
  soldAt?: string;
  salePrice?: number;
  ebayListingId?: string;
  fbListingId?: string;
  cost?: number;
  priceHistory: { price: number; at: string }[];
}

export interface Sale {
  listingId: string;
  salePrice: number;
  ebayFees: number;
  shippingCost: number;
  netProfit: number;
  soldAt: string;
}
