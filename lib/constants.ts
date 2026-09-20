export const THEME_IDS = [
  "onboarding_kyc",
  "payments_withdrawals",
  "trading_orders",
  "charges_statements",
  "app_support",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeDef {
  id: ThemeId;
  label: string;
  covers: string;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  onboarding_kyc: {
    id: "onboarding_kyc",
    label: "Onboarding & KYC",
    covers:
      "Demat account opening, KYC / e-sign delays, document uploads, verification rejections",
  },
  payments_withdrawals: {
    id: "payments_withdrawals",
    label: "Payments & Withdrawals",
    covers:
      "UPI add-funds failures, bank account linking, payout delays, SIP autopay issues",
  },
  trading_orders: {
    id: "trading_orders",
    label: "Trading & Order Execution",
    covers:
      "Order placement failures, lag during market hours, F&O, charts, price data",
  },
  charges_statements: {
    id: "charges_statements",
    label: "Charges, Statements & Reports",
    covers:
      "Brokerage / charges complaints, P&L and tax statements, contract notes",
  },
  app_support: {
    id: "app_support",
    label: "App Performance & Support",
    covers:
      "Crashes, login / OTP issues, slowness, in-app help and support response",
  },
};

export const OTHER_BUCKET = "other";

export const MAX_THEMES_IN_NOTE = 3;
export const MAX_QUOTES = 3;
export const MAX_ACTIONS = 3;
export const MAX_NOTE_WORDS = 250;

export const ACTION_OWNERS = ["Product", "Support", "Growth"] as const;
// Quote length guide (PRD suggested 8 words); relaxed to 4 so short but clear
// Hinglish reviews stay eligible as verbatim quotes.
export const QUOTE_MIN_WORDS = 4;
export const QUOTE_MAX_WORDS = 25;
export const QUOTE_CANDIDATES_PER_THEME = 6;

export const WINDOW_MIN_WEEKS = 8;
export const WINDOW_MAX_WEEKS = 12;

export const IOS_APP_ID = "1404871703";
export const ANDROID_PACKAGE = "com.nextbillion.groww";
export const COUNTRY = "in";

// Mistral model names. The free/experimental tier on this account rejects
// mistral-small-latest (429) and mistral-large-latest (403); the open
// ministral models are available. Upgrade the plan to switch back to size  +
// mistral-small / mistral-large.
export const MISTRAL_TAG_MODEL = "ministral-8b-latest";
export const MISTRAL_NOTE_MODEL = "ministral-8b-latest";

export const PIPELINE_STEPS = [
  "import",
  "redact",
  "tag",
  "aggregate",
  "note",
  "email",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];