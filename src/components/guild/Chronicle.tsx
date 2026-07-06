import { useMemo } from "preact/hooks";
import type { Language } from "../../lib/types";
import { getLanguage, useT } from "../../lib/i18n";
import { useJourney } from "../../lib/personal";
import { countryName } from "../../lib/geo";

type Translate = (key: string, params?: Record<string, string | number>) => string;

interface ChronicleItem {
  id: string;
  at: number;
  icon: string;
  summary: string;
}

/** Intl.DateTimeFormat locale for each app Language (mostly identical, zh needs a region). */
const INTL_LOCALE: Record<Language, string> = {
  en: "en",
  ja: "ja",
  zh: "zh-CN",
  ko: "ko",
  es: "es",
  fr: "fr",
  de: "de",
  pt: "pt",
};

/** Vertical quest-log timeline: journey.pins/photos/diary merged, sorted newest-first,
 * grouped under ornate day-separator headers. */
export function Chronicle() {
  const t = useT();
  const journey = useJourney();
  const lang = getLanguage();

  const items = useMemo(() => buildItems(journey, t, lang), [journey, t, lang]);
  const groups = useMemo(() => groupByDay(items, lang), [items, lang]);

  return (
    <section class="panel guild-chronicle">
      <h2 class="title-ornate guild-section-title">{t("chronicle.title")}</h2>
      {items.length === 0 ? (
        <p class="guild-chronicle-empty">{t("chronicle.empty")}</p>
      ) : (
        <div class="chronicle-list">
          {groups.map(([dayLabel, dayItems]) => (
            <div class="chronicle-day" key={dayLabel}>
              <div class="chronicle-day-header">
                <span class="chronicle-day-flourish" aria-hidden="true">
                  ❧
                </span>
                <span>{dayLabel}</span>
                <span class="chronicle-day-flourish" aria-hidden="true">
                  ❧
                </span>
              </div>
              {dayItems.map((item) => (
                <div class="chronicle-item" key={item.id}>
                  <span class="chronicle-item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span class="chronicle-item-summary">{item.summary}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function buildItems(journey: ReturnType<typeof useJourney>, t: Translate, lang: Language): ChronicleItem[] {
  const items: ChronicleItem[] = [];

  for (const pin of journey.pins) {
    const companions = pin.companions.filter((c) => c.trim().length > 0).join(", ");
    const country = pin.countryCode ? countryName(pin.countryCode, lang) : "";
    let summary: string;
    if (companions) {
      summary = country ? t("chronicle.pin", { companions, country }) : t("chronicle.pinNoCountry", { companions });
    } else {
      summary = country
        ? t("chronicle.pinTitle", { title: pin.title, country })
        : t("chronicle.pinTitleNoCountry", { title: pin.title });
    }
    items.push({ id: `pin:${pin.id}`, at: pin.at, icon: "📍", summary });
  }

  for (const photo of journey.photos) {
    const country = photo.geo?.countryCode ? countryName(photo.geo.countryCode, lang) : "";
    let summary: string;
    if (photo.arShot) {
      summary = country ? t("chronicle.arPhotoWithCountry", { country }) : t("chronicle.arPhotoPlain");
    } else if (photo.caption) {
      summary = t("chronicle.photoWithCaption", { caption: photo.caption });
    } else {
      summary = country ? t("chronicle.photoWithCountry", { country }) : t("chronicle.photoPlain");
    }
    items.push({ id: `photo:${photo.id}`, at: photo.at, icon: photo.arShot ? "✨" : "📸", summary });
  }

  for (const entry of journey.diary) {
    items.push({
      id: `diary:${entry.id}`,
      at: entry.at,
      icon: "📔",
      summary: t("chronicle.diary", { title: entry.title }),
    });
  }

  return items.sort((a, b) => b.at - a.at);
}

function groupByDay(items: ChronicleItem[], lang: Language): [string, ChronicleItem[]][] {
  const formatter = new Intl.DateTimeFormat(INTL_LOCALE[lang], { dateStyle: "full" });
  const map = new Map<string, ChronicleItem[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = formatter.format(new Date(item.at));
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }
  return order.map((key) => [key, map.get(key) as ChronicleItem[]]);
}
