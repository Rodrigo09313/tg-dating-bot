// src/lib/geocode.ts
// Reverse-geocode через Яндекс. Без зависимостей: используем глобальный fetch (Node 18+).

import { GEOCODER_PROVIDER, GEOCODER_EMAIL, YANDEX_GEOCODER_KEY } from "../config";

export type RevResult = { cityName?: string | null; raw?: any };

function pickCityFromYandex(components: any[]): string | null {
  if (!Array.isArray(components)) return null;
  const order = ["locality", "area", "province", "district", "municipality", "region"];
  for (const kind of order) {
    const hit = components.find((c) => c?.kind === kind && c?.name);
    if (hit) return String(hit.name);
  }
  const first = components.find((c) => c?.name);
  return first ? String(first.name) : null;
}

async function reverseYandex(lat: number, lon: number, lang = "ru_RU"): Promise<RevResult> {
  if (!YANDEX_GEOCODER_KEY) throw new Error("YANDEX_GEOCODER_KEY is empty");
  const url = new URL("https://geocode-maps.yandex.ru/1.x");
  url.searchParams.set("apikey", YANDEX_GEOCODER_KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("geocode", `${lon},${lat}`); // reverse: lon,lat
  url.searchParams.set("kind", "locality");
  url.searchParams.set("results", "1");
  url.searchParams.set("lang", lang);

  const headers: Record<string,string> = {
    "User-Agent": GEOCODER_EMAIL ? `tg-dating-bot/1.0 (${GEOCODER_EMAIL})` : "tg-dating-bot/1.0",
    "Accept": "application/json",
  };

  // @ts-ignore
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Geocoder(Yandex) HTTP ${res.status}`);
  const data: any = await res.json();

  const member = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
  const comps = member?.metaDataProperty?.GeocoderMetaData?.Address?.Components;
  const cityName = pickCityFromYandex(comps) || member?.name || null;

  return { cityName, raw: data };
}

export async function reverseGeocode(lat: number, lon: number, lang = "ru"): Promise<RevResult> {
  if (GEOCODER_PROVIDER === "yandex") return reverseYandex(lat, lon, lang === "ru" ? "ru_RU" : lang);
  // На будущее: другие провайдеры. Пока держим только Яндекс.
  return { cityName: null };
}
