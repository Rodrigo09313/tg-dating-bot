// src/lib/geocode.ts
// Reverse-geocode через Яндекс с жёсткой нормализацией "только город".
// 1) Пытаемся достать component.kind === 'locality'.
// 2) Если locality нет, аккуратно извлекаем из area/province по шаблонам:
//    "г. X", "город X", "городской округ X", "район города X", а также прямые названия ("Москва").
// 3) Отбрасываем "район"/"микрорайон"/"пгт"/"посёлок" и т.п.
// 4) Эта функция возвращает ПОДСКАЗКУ. В БД город пишется только когда пользователь отправит текст.

import { GEOCODER_PROVIDER, GEOCODER_EMAIL, YANDEX_GEOCODER_KEY } from "../config";

export type RevResult = { cityName?: string | null; raw?: any };

/** Нормализация короткого имени города. */
function sanitizeCity(name: string): string {
  let s = name.trim();

  // Убираем префиксы "г." / "город "
  s = s.replace(/^(г\.|город)\s+/i, "");

  // Типы НП (частые варианты), включая составные формулировки
  s = s.replace(
    /^(пос[её]лок\s+городского\s+типа|рабочий\s+пос[её]лок|городской\s+пос[её]лок|пгт)\s+/i,
    ""
  );
  s = s.replace(
    /^(пос[её]лок|поселок|село|деревня|станица|аул|хутор|селище|пос\.)\s+/i,
    ""
  );

  // Микрорайоны/кварталы — на всякий случай
  s = s.replace(/^(мкр\.?|микрорайон|квартал|кв\.)\s+/i, "");

  // Служебные хвосты в скобках
  s = s.replace(/\s*\(.*\)\s*$/, "");

  return s.trim();
}

/** Явно не город. */
function looksLikeNonCity(s: string): boolean {
  return /^\s*(микрорайон|мкр\.?|район|поселение|сельское\s+поселение)\b/i.test(s);
}

/** Привести кандидата к нормальному виду и отфильтровать мусор. */
function normalizeCandidate(s?: string | null): string | null {
  if (!s) return null;
  let name = sanitizeCity(String(s));
  if (!name) return null;
  if (looksLikeNonCity(name)) return null;
  if (name.length < 2 || name.length > 64) return null;
  return name;
}

/** Достаём ТОЛЬКО locality из Address.Components. */
function pickLocality(components: any[]): string | null {
  const loc = Array.isArray(components)
    ? components.find((c: any) => c && c.kind === "locality" && c.name)
    : null;
  return normalizeCandidate(loc?.name);
}

/** Эвристика: попытка извлечь город из area/province по распространённым шаблонам. */
function pickFromAreaProvince(components: any[]): string | null {
  if (!Array.isArray(components)) return null;

  const names: string[] = [];
  for (const c of components) {
    if (!c || !c.name) continue;
    const kind = String(c.kind || "");
    if (kind === "area" || kind === "province") {
      names.push(String(c.name));
    }
  }

  const tryPatterns = (raw: string): string | null => {
    const s = raw.trim();

    // "район города X"
    let m = s.match(/район\s+города\s+(.+)$/i);
    if (m) return normalizeCandidate(m[1]);

    // "городской округ X"
    m = s.match(/городской\s+округ\s+(.+)$/i);
    if (m) return normalizeCandidate(m[1]);

    // "г. X" или "город X"
    m = s.match(/^(?:г\.\s*|город\s+)(.+)$/i);
    if (m) return normalizeCandidate(m[1]);

    // Иногда в province просто "Москва"/"Санкт-Петербург"/"Севастополь"
    if (/^(москва|санкт-петербург|севастополь)$/i.test(s)) return normalizeCandidate(s);

    return null;
  };

  for (const n of names) {
    const cand = tryPatterns(n);
    if (cand) return cand;
  }
  return null;
}

async function reverseYandex(lat: number, lon: number, lang = "ru_RU"): Promise<RevResult> {
  if (!YANDEX_GEOCODER_KEY) throw new Error("YANDEX_GEOCODER_KEY is empty");

  const url = new URL("https://geocode-maps.yandex.ru/1.x");
  url.searchParams.set("apikey", YANDEX_GEOCODER_KEY);
  url.searchParams.set("format", "json");
  url.searchParams.set("geocode", `${lon},${lat}`); // reverse: lon,lat
  url.searchParams.set("kind", "locality");         // сразу просим городской уровень
  url.searchParams.set("results", "1");
  url.searchParams.set("lang", lang);

  const headers: Record<string, string> = {
    "User-Agent": GEOCODER_EMAIL ? `tg-dating-bot/1.0 (${GEOCODER_EMAIL})` : "tg-dating-bot/1.0",
    "Accept": "application/json",
  };

  // @ts-ignore: fetch — глобальный в Node 18+
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Geocoder(Yandex) HTTP ${res.status}`);
  const data: any = await res.json();

  const member = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
  const comps = member?.metaDataProperty?.GeocoderMetaData?.Address?.Components || [];

  // 1) locality
  let city = pickLocality(comps);

  // 2) если нет — area/province по шаблонам
  if (!city) city = pickFromAreaProvince(comps);

  // 3) финальная нормализация
  city = normalizeCandidate(city);

  return { cityName: city || null, raw: data };
}

export async function reverseGeocode(lat: number, lon: number, lang = "ru"): Promise<RevResult> {
  if (GEOCODER_PROVIDER === "yandex") {
    return reverseYandex(lat, lon, lang === "ru" ? "ru_RU" : lang);
  }
  // На будущее: другие провайдеры (OSM/OpenCage/Geoapify и т.д.)
  return { cityName: null };
}
