// Translations for the world-wide sub-national drill-down. Registered as a
// side effect on import — see src/lib/i18n.ts for the pattern. Subdivision
// display names themselves come from the vendored geojson (English `name`
// plus Natural Earth's local-script `name_local`) — only the UI chrome is
// translated here.
import { registerTranslations } from "../../../lib/i18n";

registerTranslations({
  "map.sub.title": {
    en: (p) => `${p.country} Atlas`,
    ja: (p) => `${p.country}踏破地図`,
    zh: (p) => `${p.country}地图`,
    ko: (p) => `${p.country} 지도`,
    es: (p) => `Atlas de ${p.country}`,
    fr: (p) => `Atlas · ${p.country}`,
    de: (p) => `${p.country}-Atlas`,
    pt: (p) => `Atlas de ${p.country}`,
  },
  "map.sub.back": {
    en: "Back to the World Atlas", ja: "世界地図へ戻る", zh: "返回世界地图", ko: "세계 지도로 돌아가기",
    es: "Volver al Atlas Mundial", fr: "Retour à l'Atlas du Monde", de: "Zurück zum Weltatlas", pt: "Voltar ao Atlas Mundial",
  },
  "map.sub.loading": {
    en: "Charting the provinces...", ja: "地図を作成中……", zh: "正在绘制地图……", ko: "지도를 작성하는 중...",
    es: "Trazando las provincias...", fr: "Traçage des provinces en cours...",
    de: "Die Provinzen werden kartiert...", pt: "Traçando as províncias...",
  },
  "map.sub.nodata": {
    en: "This land's detailed chart hasn't been drawn yet.",
    ja: "この国の詳細地図はまだ描かれていません。",
    zh: "这片土地的详细地图尚未绘制。",
    ko: "이 땅의 상세 지도는 아직 그려지지 않았습니다.",
    es: "El mapa detallado de esta tierra aún no se ha trazado.",
    fr: "La carte détaillée de cette terre n'a pas encore été tracée.",
    de: "Die Detailkarte dieses Landes ist noch nicht gezeichnet.",
    pt: "O mapa detalhado desta terra ainda não foi traçado.",
  },
  "map.sub.completion": {
    en: (p) => `${p.count} / ${p.total} regions explored (${p.pct}%)`,
    ja: (p) => `踏破 ${p.count} / ${p.total} 地域（${p.pct}%）`,
    zh: (p) => `已踏足 ${p.count} / ${p.total} 个地区（${p.pct}%）`,
    ko: (p) => `${p.count} / ${p.total} 지역 탐험 (${p.pct}%)`,
    es: (p) => `${p.count} / ${p.total} regiones exploradas (${p.pct}%)`,
    fr: (p) => `${p.count} / ${p.total} régions explorées (${p.pct} %)`,
    de: (p) => `${p.count} / ${p.total} Regionen erkundet (${p.pct} %)`,
    pt: (p) => `${p.count} / ${p.total} regiões exploradas (${p.pct}%)`,
  },
  "map.sub.summary": {
    en: (p) => `Your footprints mark ${p.count} of ${p.country}'s ${p.total} regions.`,
    ja: (p) => `${p.country}の${p.total}地域のうち、${p.count}地域に足あとを刻みました。`,
    zh: (p) => `你已在${p.country}的 ${p.total} 个地区中踏足 ${p.count} 个。`,
    ko: (p) => `${p.country}의 ${p.total}개 지역 중 ${p.count}곳에 발자국을 남겼습니다.`,
    es: (p) => `Tus huellas marcan ${p.count} de las ${p.total} regiones de ${p.country}.`,
    fr: (p) => `Vos pas ont marqué ${p.count} des ${p.total} régions de ${p.country}.`,
    de: (p) => `Du hast ${p.count} von ${p.total} Regionen in ${p.country} bereist.`,
    pt: (p) => `Suas pegadas marcam ${p.count} das ${p.total} regiões de ${p.country}.`,
  },
  "map.sub.complete": {
    en: "Fully explored!", ja: "全域制覇！", zh: "全境制霸！", ko: "완전 제패!",
    es: "¡Exploración completa!", fr: "Exploration complète !", de: "Vollständig erkundet!", pt: "Exploração completa!",
  },
  "map.sub.visitedState": {
    en: "Explored", ja: "踏破済み", zh: "已踏足", ko: "탐험 완료",
    es: "Explorada", fr: "Explorée", de: "Erkundet", pt: "Explorada",
  },
  "map.sub.unvisitedState": {
    en: "Still shrouded in mist...", ja: "まだ霧の中……", zh: "仍被迷雾笼罩……", ko: "아직 안개 속에...",
    es: "Aún entre la niebla...", fr: "Encore dans la brume...", de: "Noch im Nebel...", pt: "Ainda na névoa...",
  },
  "map.sub.close": {
    en: "Close", ja: "閉じる", zh: "关闭", ko: "닫기", es: "Cerrar", fr: "Fermer", de: "Schließen", pt: "Fechar",
  },
  // Shown only for dynamically-resolved countries (admin1Resolver.ts's
  // geoBoundaries fetch) — the vendored us/kr fast path is Natural Earth
  // public domain and needs no credit. Mirrors map.muni.credit's wording.
  "map.sub.credit": {
    en: "Regional boundaries: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    ja: "地域境界: © OpenStreetMap contributors · geoBoundaries（CC BY-SA）",
    zh: "地区边界：© OpenStreetMap contributors · geoBoundaries（CC BY-SA）",
    ko: "지역 경계: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    es: "Límites regionales: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    fr: "Limites régionales : © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    de: "Regionale Grenzen: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
    pt: "Limites regionais: © OpenStreetMap contributors · geoBoundaries (CC BY-SA)",
  },

  // Country display names for registered drill-downs (registry displayNameKey).
  "map.sub.country.jp": {
    en: "Japan", ja: "日本", zh: "日本", ko: "일본",
    es: "Japón", fr: "Japon", de: "Japan", pt: "Japão",
  },
  "map.sub.country.us": {
    en: "United States", ja: "アメリカ", zh: "美国", ko: "미국",
    es: "Estados Unidos", fr: "États-Unis", de: "USA", pt: "Estados Unidos",
  },
  "map.sub.country.kr": {
    en: "South Korea", ja: "韓国", zh: "韩国", ko: "대한민국",
    es: "Corea del Sur", fr: "Corée du Sud", de: "Südkorea", pt: "Coreia do Sul",
  },
});
