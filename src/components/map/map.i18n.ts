// Translations for the World Atlas (fog-of-war map) feature. Registered as a
// side effect on import — see src/lib/i18n.ts for the pattern.
import { registerTranslations } from "../../lib/i18n";

registerTranslations({
  "map.title": {
    en: "World Atlas", ja: "世界地図", zh: "世界地图", ko: "세계 지도",
    es: "Atlas Mundial", fr: "Atlas du Monde", de: "Weltatlas", pt: "Atlas Mundial",
  },
  "map.tagline": {
    en: "Uncharted lands await your footsteps...",
    ja: "未踏の地が、あなたの一歩を待っている……",
    zh: "未知的土地，正等待你的足迹……",
    ko: "미지의 땅이 당신의 발걸음을 기다립니다...",
    es: "Tierras inexploradas esperan tus pasos...",
    fr: "Des terres inexplorées attendent vos pas...",
    de: "Unerforschte Länder warten auf deine Schritte...",
    pt: "Terras inexploradas aguardam seus passos...",
  },
  "map.loading": {
    en: "Charting the realms...", ja: "地図を作成中……", zh: "正在绘制地图……", ko: "지도를 작성하는 중...",
    es: "Trazando los reinos...", fr: "Traçage des royaumes en cours...",
    de: "Die Reiche werden kartiert...", pt: "Traçando os reinos...",
  },
  "map.error": {
    en: "The cartographer's tower is sealed. Try again later.",
    ja: "地図製作者の塔は封鎖されています。後でもう一度お試しください。",
    zh: "制图师之塔已被封锁，请稍后再试。",
    ko: "지도 제작자의 탑이 봉쇄되었습니다. 나중에 다시 시도하세요.",
    es: "La torre del cartógrafo está sellada. Inténtalo de nuevo más tarde.",
    fr: "La tour du cartographe est scellée. Réessayez plus tard.",
    de: "Der Turm des Kartografen ist versiegelt. Versuche es später erneut.",
    pt: "A torre do cartógrafo está selada. Tente novamente mais tarde.",
  },
  "map.explored": {
    en: (p) => `World Explored: ${p.count} / ${p.total} (${p.pct}%)`,
    ja: (p) => `世界探索度: ${p.count} / ${p.total}（${p.pct}%）`,
    zh: (p) => `世界探索度：${p.count} / ${p.total}（${p.pct}%）`,
    ko: (p) => `세계 탐험도: ${p.count} / ${p.total} (${p.pct}%)`,
    es: (p) => `Mundo Explorado: ${p.count} / ${p.total} (${p.pct}%)`,
    fr: (p) => `Monde Exploré : ${p.count} / ${p.total} (${p.pct}%)`,
    de: (p) => `Welt erkundet: ${p.count} / ${p.total} (${p.pct}%)`,
    pt: (p) => `Mundo Explorado: ${p.count} / ${p.total} (${p.pct}%)`,
  },
  "map.continent.africa": { en: "Africa", ja: "アフリカ", zh: "非洲", ko: "아프리카", es: "África", fr: "Afrique", de: "Afrika", pt: "África" },
  "map.continent.asia": { en: "Asia", ja: "アジア", zh: "亚洲", ko: "아시아", es: "Asia", fr: "Asie", de: "Asien", pt: "Ásia" },
  "map.continent.europe": { en: "Europe", ja: "ヨーロッパ", zh: "欧洲", ko: "유럽", es: "Europa", fr: "Europe", de: "Europa", pt: "Europa" },
  "map.continent.namerica": { en: "N. America", ja: "北アメリカ", zh: "北美洲", ko: "북아메리카", es: "Norteamérica", fr: "Amérique du N.", de: "Nordamerika", pt: "América do Norte" },
  "map.continent.samerica": { en: "S. America", ja: "南アメリカ", zh: "南美洲", ko: "남아메리카", es: "Sudamérica", fr: "Amérique du S.", de: "Südamerika", pt: "América do Sul" },
  "map.continent.oceania": { en: "Oceania", ja: "オセアニア", zh: "大洋洲", ko: "오세아니아", es: "Oceanía", fr: "Océanie", de: "Ozeanien", pt: "Oceania" },
  "map.continent.antarctica": { en: "Antarctica", ja: "南極", zh: "南极洲", ko: "남극", es: "Antártida", fr: "Antarctique", de: "Antarktis", pt: "Antártida" },

  "map.sheet.newTitle": {
    en: "Chronicle an Encounter", ja: "出会いを記録する", zh: "记录一次相遇", ko: "만남을 기록하기",
    es: "Crónica de un Encuentro", fr: "Chroniquer une Rencontre", de: "Eine Begegnung festhalten", pt: "Registrar um Encontro",
  },
  "map.sheet.viewTitle": {
    en: "Encounter Record", ja: "出会いの記録", zh: "相遇记录", ko: "만남 기록",
    es: "Registro de Encuentro", fr: "Registre de Rencontre", de: "Begegnungsbericht", pt: "Registro de Encontro",
  },
  "map.sheet.locating": {
    en: "Divining the location...", ja: "位置を占っています……", zh: "正在探测位置……", ko: "위치를 점치는 중...",
    es: "Adivinando la ubicación...", fr: "Localisation en cours...", de: "Ort wird ermittelt...", pt: "Adivinhando a localização...",
  },
  "map.sheet.ocean": {
    en: "The Open Sea", ja: "大海原", zh: "茫茫大海", ko: "망망대해",
    es: "El Mar Abierto", fr: "La Mer Ouverte", de: "Die Offene See", pt: "O Mar Aberto",
  },
  "map.sheet.untitled": {
    en: "An Unnamed Encounter", ja: "名もなき出会い", zh: "无名的相遇", ko: "이름 없는 만남",
    es: "Un Encuentro Sin Nombre", fr: "Une Rencontre Sans Nom", de: "Eine Namenlose Begegnung", pt: "Um Encontro Sem Nome",
  },
  "map.sheet.titleLabel": {
    en: "Title", ja: "タイトル", zh: "标题", ko: "제목", es: "Título", fr: "Titre", de: "Titel", pt: "Título",
  },
  "map.sheet.titlePlaceholder": {
    en: "What happened here?", ja: "ここで何がありましたか？", zh: "这里发生了什么？", ko: "여기서 무슨 일이 있었나요?",
    es: "¿Qué pasó aquí?", fr: "Que s'est-il passé ici ?", de: "Was ist hier passiert?", pt: "O que aconteceu aqui?",
  },
  "map.sheet.companionsLabel": {
    en: "Companions", ja: "同行者", zh: "同伴", ko: "동행자", es: "Compañeros", fr: "Compagnons", de: "Gefährten", pt: "Companheiros",
  },
  "map.sheet.companionsPlaceholder": {
    en: "Add a companion's name", ja: "同行者の名前を追加", zh: "添加同伴姓名", ko: "동행자 이름 추가",
    es: "Añade el nombre de un compañero", fr: "Ajouter le nom d'un compagnon", de: "Namen eines Gefährten hinzufügen", pt: "Adicionar nome de um companheiro",
  },
  "map.sheet.companionsRemove": {
    en: (p) => `Remove ${p.name}`, ja: (p) => `${p.name} を削除`, zh: (p) => `移除 ${p.name}`, ko: (p) => `${p.name} 제거`,
    es: (p) => `Quitar a ${p.name}`, fr: (p) => `Retirer ${p.name}`, de: (p) => `${p.name} entfernen`, pt: (p) => `Remover ${p.name}`,
  },
  "map.sheet.noteLabel": {
    en: "Note", ja: "メモ", zh: "笔记", ko: "메모", es: "Nota", fr: "Note", de: "Notiz", pt: "Nota",
  },
  "map.sheet.notePlaceholder": {
    en: "Etch a memory of this moment...", ja: "この瞬間の記憶を刻みましょう……", zh: "刻下这一刻的记忆……", ko: "이 순간의 기억을 새겨보세요...",
    es: "Graba un recuerdo de este momento...", fr: "Gravez un souvenir de cet instant...",
    de: "Halte eine Erinnerung an diesen Moment fest...", pt: "Grave uma lembrança deste momento...",
  },
  "map.sheet.save": {
    en: "Seal the Chronicle", ja: "記録を刻む", zh: "封存记录", ko: "기록 봉인하기",
    es: "Sellar la Crónica", fr: "Sceller la Chronique", de: "Chronik Versiegeln", pt: "Selar a Crônica",
  },
  "map.sheet.cancel": {
    en: "Close", ja: "閉じる", zh: "关闭", ko: "닫기", es: "Cerrar", fr: "Fermer", de: "Schließen", pt: "Fechar",
  },
  "map.sheet.delete": {
    en: "Erase Record", ja: "記録を消す", zh: "删除记录", ko: "기록 삭제", es: "Borrar Registro", fr: "Effacer le Registre", de: "Eintrag Löschen", pt: "Apagar Registro",
  },
  "map.sheet.deleteConfirm": {
    en: "Tap again to erase", ja: "もう一度タップで消去", zh: "再次点击以删除", ko: "한 번 더 누르면 삭제", es: "Toca de nuevo para borrar", fr: "Touchez encore pour effacer", de: "Zum Löschen erneut tippen", pt: "Toque novamente para apagar",
  },
  "map.fab.add": {
    en: "New Encounter", ja: "出会いを記録", zh: "记录相遇", ko: "새로운 만남",
    es: "Nuevo Encuentro", fr: "Nouvelle Rencontre", de: "Neue Begegnung", pt: "Novo Encontro",
  },
  "map.empty.title": {
    en: "No Encounters Yet", ja: "まだ出会いがありません", zh: "尚无相遇记录", ko: "아직 만남이 없습니다",
    es: "Aún No Hay Encuentros", fr: "Aucune Rencontre Pour l'Instant", de: "Noch Keine Begegnungen", pt: "Ainda Sem Encontros",
  },
  "map.empty.hint": {
    en: "Record your first encounter to start revealing the map.",
    ja: "最初の出会いを記録して、地図を切り開こう。",
    zh: "记录你的第一次相遇，开始揭开地图的迷雾。",
    ko: "첫 만남을 기록해 지도를 밝혀보세요.",
    es: "Registra tu primer encuentro para empezar a revelar el mapa.",
    fr: "Enregistrez votre première rencontre pour commencer à révéler la carte.",
    de: "Halte deine erste Begegnung fest, um die Karte aufzudecken.",
    pt: "Registre seu primeiro encontro para começar a revelar o mapa.",
  },
  "map.sheet.companionsAdd": {
    en: "Add companion", ja: "同行者を追加", zh: "添加同伴", ko: "동행자 추가",
    es: "Añadir compañero", fr: "Ajouter un compagnon", de: "Gefährten hinzufügen", pt: "Adicionar companheiro",
  },
  "map.hint.joinRoom": {
    en: "Join or found a fellowship first — encounters are recorded in the party's shared chronicle.",
    ja: "まずパーティに参加するか結成してください。出会いはパーティ共有の記録に刻まれます。",
    zh: "请先加入或组建一支队伍——相遇会被记录到队伍共享的编年史中。",
    ko: "먼저 파티에 참가하거나 결성하세요. 만남은 파티의 공유 기록에 남습니다.",
    es: "Únete o forma una compañía primero — los encuentros se registran en la crónica compartida del grupo.",
    fr: "Rejoignez ou fondez d'abord une compagnie — les rencontres sont inscrites dans la chronique partagée du groupe.",
    de: "Tritt zuerst einer Gemeinschaft bei oder gründe eine — Begegnungen werden in der gemeinsamen Chronik der Gruppe festgehalten.",
    pt: "Entre ou funde uma companhia primeiro — os encontros são registrados na crônica compartilhada do grupo.",
  },
});

// Japan prefecture drill-down + collection + brag card. Prefecture display
// names themselves come from the geojson (name_ja for ja, English name for
// every other language) — only the UI chrome is translated here.
registerTranslations({
  "map.jp.title": {
    en: "Japan Atlas", ja: "日本踏破地図", zh: "日本地图", ko: "일본 지도",
    es: "Atlas de Japón", fr: "Atlas du Japon", de: "Japan-Atlas", pt: "Atlas do Japão",
  },
  "map.jp.open": {
    en: "Japan", ja: "日本", zh: "日本", ko: "일본",
    es: "Japón", fr: "Japon", de: "Japan", pt: "Japão",
  },
  "map.jp.back": {
    en: "Back to the World Atlas", ja: "世界地図へ戻る", zh: "返回世界地图", ko: "세계 지도로 돌아가기",
    es: "Volver al Atlas Mundial", fr: "Retour à l'Atlas du Monde", de: "Zurück zum Weltatlas", pt: "Voltar ao Atlas Mundial",
  },
  "map.jp.completion": {
    en: (p) => `${p.count} / ${p.total} prefectures explored (${p.pct}%)`,
    ja: (p) => `踏破 ${p.count} / ${p.total} 都道府県（${p.pct}%）`,
    zh: (p) => `已踏足 ${p.count} / ${p.total} 个都道府县（${p.pct}%）`,
    ko: (p) => `${p.count} / ${p.total} 도도부현 탐험 (${p.pct}%)`,
    es: (p) => `${p.count} / ${p.total} prefecturas exploradas (${p.pct}%)`,
    fr: (p) => `${p.count} / ${p.total} préfectures explorées (${p.pct} %)`,
    de: (p) => `${p.count} / ${p.total} Präfekturen erkundet (${p.pct} %)`,
    pt: (p) => `${p.count} / ${p.total} prefeituras exploradas (${p.pct}%)`,
  },
  "map.jp.visitedState": {
    en: "Explored", ja: "踏破済み", zh: "已踏足", ko: "탐험 완료",
    es: "Explorada", fr: "Explorée", de: "Erkundet", pt: "Explorada",
  },
  "map.jp.unvisitedState": {
    en: "Still shrouded in mist...", ja: "まだ霧の中……", zh: "仍被迷雾笼罩……", ko: "아직 안개 속에...",
    es: "Aún entre la niebla...", fr: "Encore dans la brume...", de: "Noch im Nebel...", pt: "Ainda na névoa...",
  },

  "map.jp.rarity.common": {
    en: "Common", ja: "コモン", zh: "普通", ko: "일반",
    es: "Común", fr: "Commune", de: "Gewöhnlich", pt: "Comum",
  },
  "map.jp.rarity.uncommon": {
    en: "Uncommon", ja: "アンコモン", zh: "少见", ko: "특별",
    es: "Poco común", fr: "Peu commune", de: "Ungewöhnlich", pt: "Incomum",
  },
  "map.jp.rarity.rare": {
    en: "Rare", ja: "レア", zh: "稀有", ko: "희귀",
    es: "Rara", fr: "Rare", de: "Selten", pt: "Rara",
  },
  "map.jp.rarity.legendary": {
    en: "Legendary", ja: "レジェンダリー", zh: "传说", ko: "전설",
    es: "Legendaria", fr: "Légendaire", de: "Legendär", pt: "Lendária",
  },

  "map.jp.region.hokkaido": { en: "Hokkaido", ja: "北海道", zh: "北海道", ko: "홋카이도", es: "Hokkaido", fr: "Hokkaido", de: "Hokkaido", pt: "Hokkaido" },
  "map.jp.region.tohoku": { en: "Tohoku", ja: "東北", zh: "东北", ko: "도호쿠", es: "Tohoku", fr: "Tohoku", de: "Tohoku", pt: "Tohoku" },
  "map.jp.region.kanto": { en: "Kanto", ja: "関東", zh: "关东", ko: "간토", es: "Kanto", fr: "Kanto", de: "Kanto", pt: "Kanto" },
  "map.jp.region.chubu": { en: "Chubu", ja: "中部", zh: "中部", ko: "주부", es: "Chubu", fr: "Chubu", de: "Chubu", pt: "Chubu" },
  "map.jp.region.kinki": { en: "Kansai", ja: "近畿", zh: "近畿", ko: "간사이", es: "Kansai", fr: "Kansai", de: "Kansai", pt: "Kansai" },
  "map.jp.region.chugoku": { en: "Chugoku", ja: "中国", zh: "中国地方", ko: "주고쿠", es: "Chugoku", fr: "Chugoku", de: "Chugoku", pt: "Chugoku" },
  "map.jp.region.shikoku": { en: "Shikoku", ja: "四国", zh: "四国", ko: "시코쿠", es: "Shikoku", fr: "Shikoku", de: "Shikoku", pt: "Shikoku" },
  "map.jp.region.kyushu": { en: "Kyushu", ja: "九州", zh: "九州", ko: "규슈", es: "Kyushu", fr: "Kyushu", de: "Kyushu", pt: "Kyushu" },
  "map.jp.region.okinawa": { en: "Okinawa", ja: "沖縄", zh: "冲绳", ko: "오키나와", es: "Okinawa", fr: "Okinawa", de: "Okinawa", pt: "Okinawa" },

  "map.jp.badge.first-step": {
    en: "First Footprint", ja: "最初の一歩", zh: "第一个脚印", ko: "첫 발자국",
    es: "Primera Huella", fr: "Première Empreinte", de: "Erster Fußabdruck", pt: "Primeira Pegada",
  },
  "map.jp.badge.ten": {
    en: "Ten Prefectures", ja: "十県踏破", zh: "踏足十县", ko: "10개 현 달성",
    es: "Diez Prefecturas", fr: "Dix Préfectures", de: "Zehn Präfekturen", pt: "Dez Prefeituras",
  },
  "map.jp.badge.half": {
    en: "Halfway There", ja: "折り返し地点", zh: "行程过半", ko: "절반 돌파",
    es: "A Mitad de Camino", fr: "À Mi-Chemin", de: "Halbzeit", pt: "Metade do Caminho",
  },
  "map.jp.badge.forty": {
    en: "Grand Wayfarer", ja: "四十県の旅人", zh: "四十县旅人", ko: "40개 현의 여행자",
    es: "Gran Caminante", fr: "Grand Voyageur", de: "Großer Wanderer", pt: "Grande Viajante",
  },
  "map.jp.badge.complete": {
    en: "Japan Complete!", ja: "日本全国制覇！", zh: "全日本制霸！", ko: "일본 전국 제패!",
    es: "¡Japón al Completo!", fr: "Japon Complet !", de: "Ganz Japan!", pt: "Japão Completo!",
  },
  "map.jp.badge.hidden-gem": {
    en: "Off the Beaten Path", ja: "秘境を知る者", zh: "秘境行者", ko: "숨은 명소 탐험가",
    es: "Fuera de Ruta", fr: "Hors des Sentiers Battus", de: "Abseits der Pfade", pt: "Fora do Roteiro",
  },
  "map.jp.badge.region": {
    en: (p) => `All of ${p.region}`, ja: (p) => `${p.region}制覇`, zh: (p) => `${p.region}全境制霸`, ko: (p) => `${p.region} 완전 제패`,
    es: (p) => `Todo ${p.region}`, fr: (p) => `Tout ${p.region}`, de: (p) => `Ganz ${p.region}`, pt: (p) => `Todo ${p.region}`,
  },

  "map.brag.make": {
    en: "Brag Card", ja: "自慢カード", zh: "炫耀卡", ko: "자랑 카드",
    es: "Tarjeta de Logros", fr: "Carte de Fierté", de: "Prahlkarte", pt: "Cartão de Conquistas",
  },
  "map.brag.title": {
    en: "My Japan Conquest", ja: "わたしの日本踏破", zh: "我的日本足迹", ko: "나의 일본 정복",
    es: "Mi Conquista de Japón", fr: "Ma Conquête du Japon", de: "Meine Japan-Eroberung", pt: "Minha Conquista do Japão",
  },
  "map.brag.makeWorld": {
    en: "World Card", ja: "世界カード", zh: "世界卡片", ko: "세계 카드",
    es: "Tarjeta Mundial", fr: "Carte du Monde", de: "Weltkarte", pt: "Cartão Mundial",
  },
  "map.brag.worldTitle": {
    en: "My World Conquest", ja: "わたしの世界踏破", zh: "我的世界足迹", ko: "나의 세계 정복",
    es: "Mi Conquista del Mundo", fr: "Ma Conquête du Monde", de: "Meine Welt-Eroberung", pt: "Minha Conquista do Mundo",
  },
  "map.brag.share": {
    en: "Share", ja: "共有", zh: "分享", ko: "공유",
    es: "Compartir", fr: "Partager", de: "Teilen", pt: "Compartilhar",
  },
  "map.brag.download": {
    en: "Save Image", ja: "画像を保存", zh: "保存图片", ko: "이미지 저장",
    es: "Guardar Imagen", fr: "Enregistrer l'Image", de: "Bild Speichern", pt: "Salvar Imagem",
  },
});
