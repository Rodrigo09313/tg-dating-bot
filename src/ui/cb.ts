// src/ui/cb.ts
import { CB } from "../types";

export type ParsedCb = {
  prefix: string;
  verb: string;
  id?: string;
  raw: string;
};

export function parseCb(raw?: string): ParsedCb | null {
  const s = String(raw || "");
  if (!s) return null;
  const [prefix = "", verb = "", id] = s.split(":");
  if (!prefix || !verb) return null;
  return { prefix, verb, id, raw: s };
}

/** Сборка callback_data: <prefix>:<verb>[:<id>] */
export function mkCb(prefix: CB | string, verb: string, id?: string | number): string {
  const base = `${prefix}:${verb}`;
  return id === undefined ? base : `${base}:${String(id)}`;
}
