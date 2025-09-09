// src/ui/cb.ts
import { CB } from "../types";
export function mkCb(prefix: typeof CB[keyof typeof CB], verb: string, id?: string|number): string {
  const parts = [prefix, verb];
  if (id !== undefined && id !== null) parts.push(String(id));
  const s = parts.join(":");
  if (Buffer.byteLength(s,"utf8") > 64) throw new Error(`callback_data слишком длинный (${Buffer.byteLength(s)})`);
  return s;
}
export function parseCb(data: string): { prefix:string; verb:string; id?:string } | null {
  const [prefix, verb, id] = data.split(":");
  if (!prefix || !verb) return null;
  return { prefix, verb, id };
}
