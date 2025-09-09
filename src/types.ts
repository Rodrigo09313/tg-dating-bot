// src/types.ts
export type UserState =
  | "idle"
  | "reg_age"
  | "reg_gender"
  | "reg_seek"
  | "reg_city"
  | "reg_name"
  | "reg_about"
  | "reg_photo"
  | "reg_preview"
  | "profile"
  | "browse"
  | "browse_card"
  | "roulette_queue"
  | "roulette_chat"
  | "edit_about"
  | "edit_photo";

export const CB = {
  REG: "reg",
  PRF: "prf",
  BRW: "brw",
  RL:  "rl",
  CR:  "cr",
  REP: "rep",
  SYS: "sys",
} as const;
