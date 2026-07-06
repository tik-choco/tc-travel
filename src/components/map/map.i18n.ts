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
