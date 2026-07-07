// Translations for the municipality (市区町村) collection tier. Registered as
// a side effect on import — see src/lib/i18n.ts for the pattern. Municipality
// display names come from the vendored geojson (romaji only for now — the
// geoBoundaries source carries no Japanese names; a future JIS join adds
// name_ja); only the UI chrome is translated here.
import { registerTranslations } from "../../../lib/i18n";

registerTranslations({
  "map.muni.title": {
    en: (p) => `${p.pref} · Municipalities`,
    ja: (p) => `${p.pref}の市区町村`,
    zh: (p) => `${p.pref} · 市区町村`,
    ko: (p) => `${p.pref} 시구정촌`,
    es: (p) => `${p.pref} · Municipios`,
    fr: (p) => `${p.pref} · Communes`,
    de: (p) => `${p.pref} · Gemeinden`,
    pt: (p) => `${p.pref} · Municípios`,
  },
  "map.muni.count": {
    en: (p) => `${p.count} / ${p.total} municipalities explored (${p.pct}%)`,
    ja: (p) => `踏破 ${p.count} / ${p.total} 市区町村（${p.pct}%）`,
    zh: (p) => `已踏足 ${p.count} / ${p.total} 个市区町村（${p.pct}%）`,
    ko: (p) => `${p.count} / ${p.total} 시구정촌 탐험 (${p.pct}%)`,
    es: (p) => `${p.count} / ${p.total} municipios explorados (${p.pct}%)`,
    fr: (p) => `${p.count} / ${p.total} communes explorées (${p.pct} %)`,
    de: (p) => `${p.count} / ${p.total} Gemeinden erkundet (${p.pct} %)`,
    pt: (p) => `${p.count} / ${p.total} municípios explorados (${p.pct}%)`,
  },
  "map.muni.overall": {
    en: (p) => `Municipalities: ${p.count} / ${p.total}`,
    ja: (p) => `市区町村 ${p.count} / ${p.total}`,
    zh: (p) => `市区町村：${p.count} / ${p.total}`,
    ko: (p) => `시구정촌 ${p.count} / ${p.total}`,
    es: (p) => `Municipios: ${p.count} / ${p.total}`,
    fr: (p) => `Communes : ${p.count} / ${p.total}`,
    de: (p) => `Gemeinden: ${p.count} / ${p.total}`,
    pt: (p) => `Municípios: ${p.count} / ${p.total}`,
  },
  "map.muni.open": {
    en: (p) => `Municipalities ${p.count}/${p.total}`,
    ja: (p) => `市区町村 ${p.count}/${p.total}`,
    zh: (p) => `市区町村 ${p.count}/${p.total}`,
    ko: (p) => `시구정촌 ${p.count}/${p.total}`,
    es: (p) => `Municipios ${p.count}/${p.total}`,
    fr: (p) => `Communes ${p.count}/${p.total}`,
    de: (p) => `Gemeinden ${p.count}/${p.total}`,
    pt: (p) => `Municípios ${p.count}/${p.total}`,
  },
  "map.muni.back": {
    en: "Back to the Japan Atlas", ja: "日本地図へ戻る", zh: "返回日本地图", ko: "일본 지도로 돌아가기",
    es: "Volver al Atlas de Japón", fr: "Retour à l'Atlas du Japon", de: "Zurück zum Japan-Atlas", pt: "Voltar ao Atlas do Japão",
  },
  "map.muni.loading": {
    en: "Charting the municipalities...", ja: "地図を作成中……", zh: "正在绘制地图……", ko: "지도를 작성하는 중...",
    es: "Trazando los municipios...", fr: "Traçage des communes en cours...",
    de: "Die Gemeinden werden kartiert...", pt: "Traçando os municípios...",
  },
  "map.muni.empty": {
    en: "No municipal chart for this prefecture yet.",
    ja: "この都道府県の市区町村データはまだありません。",
    zh: "该都道府县的市区町村数据尚未收录。",
    ko: "이 도도부현의 시구정촌 데이터가 아직 없습니다.",
    es: "Aún no hay mapa municipal para esta prefectura.",
    fr: "Pas encore de carte communale pour cette préfecture.",
    de: "Für diese Präfektur gibt es noch keine Gemeindekarte.",
    pt: "Ainda não há mapa municipal para esta prefeitura.",
  },
  "map.muni.visitedState": {
    en: "Explored", ja: "踏破済み", zh: "已踏足", ko: "탐험 완료",
    es: "Explorado", fr: "Explorée", de: "Erkundet", pt: "Explorado",
  },
  "map.muni.unvisitedState": {
    en: "Still shrouded in mist...", ja: "まだ霧の中……", zh: "仍被迷雾笼罩……", ko: "아직 안개 속에...",
    es: "Aún entre la niebla...", fr: "Encore dans la brume...", de: "Noch im Nebel...", pt: "Ainda na névoa...",
  },
  // CC BY-SA attribution — required by the data license; the © credit itself
  // stays constant across languages, only the label localizes.
  "map.muni.credit": {
    en: "Municipal boundaries: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    ja: "市区町村境界: © OpenStreetMap contributors · geoBoundaries（CC BY-SA）",
    zh: "市区町村边界：© OpenStreetMap contributors · geoBoundaries（CC BY-SA）",
    ko: "시구정촌 경계: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    es: "Límites municipales: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    fr: "Limites communales : © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    de: "Gemeindegrenzen: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    pt: "Limites municipais: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
  },
});
