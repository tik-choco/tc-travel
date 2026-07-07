// Translations for the 3D globe map. Registered as a side effect on import —
// see src/lib/i18n.ts for the pattern. The globe deliberately reuses the
// World Atlas keys (map.title, map.explored, map.continent.*, the sheet and
// FAB strings) from map.i18n.ts so both map skins speak with one voice; only
// globe-specific strings live here.
import { registerTranslations } from "../../../lib/i18n";

registerTranslations({
  "globe.aria": {
    en: "3D globe of your travels. Drag to spin the world, pinch or scroll to fly closer, tap to chronicle an encounter.",
    ja: "旅の3D地球儀。ドラッグで回転、ピンチやスクロールで近づき、タップで出会いを記録します。",
    zh: "你的旅行3D地球仪。拖动旋转世界，捏合或滚动拉近，点按记录相遇。",
    ko: "여행의 3D 지구본. 드래그로 회전, 핀치나 스크롤로 가까이, 탭으로 만남을 기록하세요.",
    es: "Globo 3D de tus viajes. Arrastra para girar, pellizca o desplaza para acercarte, toca para registrar un encuentro.",
    fr: "Globe 3D de vos voyages. Faites glisser pour tourner, pincez ou faites défiler pour approcher, touchez pour consigner une rencontre.",
    de: "3D-Globus deiner Reisen. Ziehen zum Drehen, kneifen oder scrollen zum Annähern, tippen zum Festhalten einer Begegnung.",
    pt: "Globo 3D das suas viagens. Arraste para girar, belisque ou role para se aproximar, toque para registrar um encontro.",
  },
  "globe.error": {
    en: "The crystal globe is clouded — this device could not conjure the 3D view.",
    ja: "水晶の地球儀が曇っています——この端末では3D表示を呼び出せませんでした。",
    zh: "水晶地球仪蒙上了雾——此设备无法召唤3D视图。",
    ko: "수정 지구본이 흐려졌습니다 — 이 기기에서는 3D 화면을 불러올 수 없었습니다.",
    es: "El globo de cristal está nublado: este dispositivo no pudo invocar la vista 3D.",
    fr: "Le globe de cristal s'est voilé — cet appareil n'a pas pu invoquer la vue 3D.",
    de: "Die Kristallkugel ist getrübt — dieses Gerät konnte die 3D-Ansicht nicht heraufbeschwören.",
    pt: "O globo de cristal está nublado — este dispositivo não conseguiu invocar a visão 3D.",
  },
  "globe.loadError": {
    en: "The globe could not be summoned. Check your connection and try again.",
    ja: "地球儀を呼び出せませんでした。接続を確認して、もう一度お試しください。",
    zh: "无法召唤地球仪。请检查网络连接后重试。",
    ko: "지구본을 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.",
    es: "No se pudo invocar el globo. Revisa tu conexión e inténtalo de nuevo.",
    fr: "Le globe n'a pas pu être invoqué. Vérifiez votre connexion et réessayez.",
    de: "Der Globus konnte nicht beschworen werden. Prüfe deine Verbindung und versuche es erneut.",
    pt: "O globo não pôde ser invocado. Verifique sua conexão e tente novamente.",
  },
  // Exploration hero: municipality-unit counts (a world-% would round to 0 forever).
  "globe.stats.hero": {
    en: (p) => `${p.munis} municipalities · ${p.countries} countries`,
    ja: (p) => `${p.munis}市町村・${p.countries}カ国`,
    zh: (p) => `${p.munis}个市镇 · ${p.countries}个国家`,
    ko: (p) => `${p.munis}개 시군구 · ${p.countries}개국`,
    es: (p) => `${p.munis} municipios · ${p.countries} países`,
    fr: (p) => `${p.munis} communes · ${p.countries} pays`,
    de: (p) => `${p.munis} Gemeinden · ${p.countries} Länder`,
    pt: (p) => `${p.munis} municípios · ${p.countries} países`,
  },
  "globe.stats.counting": {
    en: "Charting your footprints…",
    ja: "足あとを数えています……",
    zh: "正在清点足迹……",
    ko: "발자취를 세는 중...",
    es: "Contando tus huellas…",
    fr: "On recense vos traces…",
    de: "Deine Spuren werden gezählt…",
    pt: "Contando suas pegadas…",
  },
  // Sheet location line once the municipality resolves, e.g. "Shinjuku · Japan".
  "globe.sheet.place": {
    en: (p) => `${p.muni} · ${p.country}`,
    ja: (p) => `${p.muni}・${p.country}`,
    zh: (p) => `${p.muni}・${p.country}`,
    ko: (p) => `${p.muni} · ${p.country}`,
    es: (p) => `${p.muni} · ${p.country}`,
    fr: (p) => `${p.muni} · ${p.country}`,
    de: (p) => `${p.muni} · ${p.country}`,
    pt: (p) => `${p.muni} · ${p.country}`,
  },
});
