import { registerTranslations } from "../../lib/i18n";

// Copy for the momentary reward bursts (see CelebrationHost). Warm and brief —
// this is a passing high-five, not a screen to read.
registerTranslations({
  "celebrate.achievementUnlocked": {
    en: "Achievement unlocked", ja: "実績を解除", zh: "成就解锁", ko: "업적 달성",
    es: "Logro desbloqueado", fr: "Succès débloqué", de: "Erfolg freigeschaltet", pt: "Conquista desbloqueada",
  },
  "celebrate.level": {
    en: (p) => `Level ${p.level}`, ja: (p) => `レベル${p.level}`, zh: (p) => `${p.level} 级`, ko: (p) => `레벨 ${p.level}`,
    es: (p) => `Nivel ${p.level}`, fr: (p) => `Niveau ${p.level}`, de: (p) => `Level ${p.level}`, pt: (p) => `Nível ${p.level}`,
  },
  "celebrate.streak": {
    en: (p) => `${p.days}-day streak!`, ja: (p) => `${p.days}日連続！`, zh: (p) => `连续 ${p.days} 天！`, ko: (p) => `${p.days}일 연속!`,
    es: (p) => `¡Racha de ${p.days} días!`, fr: (p) => `Série de ${p.days} jours !`, de: (p) => `${p.days}-Tage-Serie!`, pt: (p) => `Sequência de ${p.days} dias!`,
  },
  "celebrate.streakDetail": {
    en: "Keep the flame alive!", ja: "この調子で続けよう！", zh: "保持下去！", ko: "이 기세를 이어가세요!",
    es: "¡Mantén la racha!", fr: "Continue comme ça !", de: "Bleib dran!", pt: "Mantenha o ritmo!",
  },

  // --- Progressive unlocks (see lib/unlocks.ts). The app "noticing" in a warm,
  //     second-person voice — never gamer-speak. title + ".detail" per tier. ---
  "unlock.companionWake": {
    en: "Someone woke up to greet you", ja: "あの子が目を覚ましました", zh: "有人醒来迎接你",
    ko: "누군가 깨어나 당신을 맞이합니다", es: "Alguien despertó para saludarte",
    fr: "Quelqu'un s'est réveillé pour t'accueillir", de: "Jemand ist erwacht, um dich zu begrüßen",
    pt: "Alguém acordou para te receber",
  },
  "unlock.companionWake.detail": {
    en: "Your journey has begun.", ja: "あなたの旅がはじまりました。", zh: "你的旅程已经开始。",
    ko: "당신의 여정이 시작되었어요.", es: "Tu viaje ha comenzado.", fr: "Ton voyage a commencé.",
    de: "Deine Reise hat begonnen.", pt: "Sua jornada começou.",
  },
  "unlock.lens.golden": {
    en: "Golden-hour light is yours", ja: "『金色の光』が使えるように", zh: "「金色时光」已属于你",
    ko: "'황금빛 노을'을 담을 수 있어요", es: "La luz dorada es tuya", fr: "La lumière dorée est à toi",
    de: "Das goldene Licht gehört dir", pt: "A luz dourada é sua",
  },
  "unlock.lens.golden.detail": {
    en: "Your lens learned the colour of dusk.", ja: "レンズが夕暮れの色を覚えたみたい。",
    zh: "你的镜头记住了黄昏的颜色。", ko: "렌즈가 노을빛을 기억한 것 같아요.",
    es: "Tu lente aprendió el color del atardecer.", fr: "Ton objectif a appris la couleur du crépuscule.",
    de: "Dein Objektiv hat die Farbe der Dämmerung gelernt.", pt: "Sua lente aprendeu a cor do entardecer.",
  },
  "unlock.lens.film": {
    en: "A film-grain warmth", ja: "『フィルムの温もり』", zh: "「胶片的温度」",
    ko: "'필름의 온기'", es: "Una calidez de película", fr: "Une chaleur argentique",
    de: "Eine Film-Wärme", pt: "Um calor de filme",
  },
  "unlock.lens.film.detail": {
    en: "Twenty-five frames in, your photos carry a softer, older light.",
    ja: "25枚目。写真がやわらかく懐かしい光をまといました。",
    zh: "第 25 张，你的照片染上了柔和而怀旧的光。",
    ko: "스물다섯 장째, 사진에 부드럽고 오래된 빛이 스몄어요.",
    es: "Veinticinco fotos después, tus imágenes llevan una luz más suave y antigua.",
    fr: "Vingt-cinq photos plus tard, tes images portent une lumière plus douce, plus ancienne.",
    de: "Fünfundzwanzig Bilder später tragen deine Fotos ein weicheres, älteres Licht.",
    pt: "Vinte e cinco fotos depois, suas imagens carregam uma luz mais suave e antiga.",
  },
  "unlock.lens.lantern": {
    en: "Night-lantern glow", ja: "『提灯の灯り』", zh: "「灯笼夜光」",
    ko: "'등불의 빛'", es: "Resplandor de farol nocturno", fr: "Lueur de lanterne nocturne",
    de: "Laternen-Leuchten", pt: "Brilho de lanterna noturna",
  },
  "unlock.lens.lantern.detail": {
    en: "Fifty frames in — your lens holds the warmth of lantern light.",
    ja: "50枚目。レンズが提灯のあたたかな灯りを宿しました。",
    zh: "第 50 张，你的镜头留住了灯笼的暖光。",
    ko: "쉰 장째, 렌즈가 등불의 온기를 품었어요.",
    es: "Cincuenta fotos: tu lente guarda la calidez de la luz de un farol.",
    fr: "Cinquante photos : ton objectif retient la chaleur d'une lanterne.",
    de: "Fünfzig Bilder — dein Objektiv hält die Wärme des Laternenlichts.",
    pt: "Cinquenta fotos — sua lente guarda o calor da luz de uma lanterna.",
  },
  "unlock.card.first": {
    en: "Your first card, framed", ja: "はじめてのカードに縁どりを", zh: "你的第一张卡片有了边框",
    ko: "첫 카드에 테두리가 생겼어요", es: "Tu primera tarjeta, enmarcada",
    fr: "Ta première carte, encadrée", de: "Deine erste Karte, gerahmt",
    pt: "Seu primeiro cartão, emoldurado",
  },
  "unlock.card.first.detail": {
    en: "A meeting worth its own little border.", ja: "出会いに、小さな飾りがふさわしい。",
    zh: "一次相遇，值得一道小小的边饰。", ko: "만남에 어울리는 작은 장식이에요.",
    es: "Un encuentro que merece su propio marco.", fr: "Une rencontre qui mérite son cadre.",
    de: "Eine Begegnung, die einen eigenen Rahmen verdient.", pt: "Um encontro que merece sua própria moldura.",
  },
  "unlock.card.gold": {
    en: "Gold trim for your cards", ja: "カードに金の縁どりを", zh: "你的卡片镶上了金边",
    ko: "카드에 금빛 테두리가", es: "Ribete dorado para tus tarjetas",
    fr: "Une bordure dorée pour tes cartes", de: "Goldrand für deine Karten",
    pt: "Acabamento dourado para seus cartões",
  },
  "unlock.card.gold.detail": {
    en: "Ten people met in person — your keepsakes wear gold now.",
    ja: "10人と直接出会いました。思い出が金色をまといます。",
    zh: "与十个人当面相遇——你的珍藏披上了金色。",
    ko: "열 사람을 직접 만났어요. 소중한 기억이 금빛을 둘렀어요.",
    es: "Diez personas en persona: tus recuerdos ahora visten de oro.",
    fr: "Dix personnes rencontrées en vrai — tes souvenirs se parent d'or.",
    de: "Zehn Menschen persönlich getroffen — deine Andenken tragen nun Gold.",
    pt: "Dez pessoas conhecidas pessoalmente — suas lembranças agora vestem ouro.",
  },
});
