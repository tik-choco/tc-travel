// Translations for the app shell: tab bar, header, error boundary.
import { registerTranslations } from "../../lib/i18n";

registerTranslations({
  "tab.nav": {
    en: "Main navigation",
    ja: "メインナビゲーション",
    zh: "主导航",
    ko: "메인 내비게이션",
    es: "Navegación principal",
    fr: "Navigation principale",
    de: "Hauptnavigation",
    pt: "Navegação principal",
  },
  // Short tab-bar labels. The fantasy screen names (`tab.*` in common.i18n.ts)
  // overflow the fixed ~60px tab width in European languages, so the visible
  // label uses these; keep every language to one short word.
  "tab.short.home": { en: "Home", ja: "ホーム", zh: "主页", ko: "홈", es: "Inicio", fr: "Accueil", de: "Start", pt: "Início" },
  "tab.short.map": { en: "Map", ja: "地図", zh: "地图", ko: "지도", es: "Mapa", fr: "Carte", de: "Karte", pt: "Mapa" },
  "tab.short.album": { en: "Album", ja: "アルバム", zh: "相册", ko: "앨범", es: "Álbum", fr: "Album", de: "Album", pt: "Álbum" },
  "tab.short.diary": { en: "Journal", ja: "日記", zh: "日记", ko: "일기", es: "Diario", fr: "Journal", de: "Tagebuch", pt: "Diário" },
  "tab.short.avatar": { en: "Avatar", ja: "アバター", zh: "化身", ko: "아바타", es: "Avatar", fr: "Avatar", de: "Avatar", pt: "Avatar" },
  "tab.short.post": { en: "Cards", ja: "名刺", zh: "名片", ko: "명함", es: "Tarjetas", fr: "Cartes", de: "Karten", pt: "Cartões" },
  "tab.short.guild": { en: "Guild", ja: "ギルド", zh: "公会", ko: "길드", es: "Gremio", fr: "Guilde", de: "Gilde", pt: "Guilda" },

  // Solo-mode top-bar wordmark (no room to name). Warm and personal, never
  // "you're alone" — this is your own travelogue.
  "header.solo.title": {
    en: "My Journey",
    ja: "わたしの旅",
    zh: "我的旅程",
    ko: "나의 여정",
    es: "Mi Viaje",
    fr: "Mon Voyage",
    de: "Meine Reise",
    pt: "Minha Jornada",
  },

  // Truthful three-state presence line (see store.ts useSession): the old
  // binary connected/disconnected read "Connected" while you were still alone.
  "header.presence.connecting": {
    en: "Connecting…",
    ja: "接続中…",
    zh: "连接中…",
    ko: "연결 중…",
    es: "Conectando…",
    fr: "Connexion…",
    de: "Verbindet…",
    pt: "Conectando…",
  },
  "header.presence.waiting": {
    en: "Waiting for your partner…",
    ja: "なかまを待っています…",
    zh: "正在等待伙伴…",
    ko: "동료를 기다리는 중…",
    es: "Esperando a tu compañero…",
    fr: "En attente de ton compagnon…",
    de: "Warten auf deine Gefährten…",
    pt: "Esperando seu companheiro…",
  },
  "header.presence.together": {
    en: "Together",
    ja: "いっしょ",
    zh: "在一起",
    ko: "함께",
    es: "Juntos",
    fr: "Ensemble",
    de: "Zusammen",
    pt: "Juntos",
  },
  "header.share": { en: "Share", ja: "共有", zh: "分享", ko: "공유", es: "Compartir", fr: "Partager", de: "Teilen", pt: "Compartilhar" },
  "header.leave": { en: "Leave", ja: "退室", zh: "离开", ko: "나가기", es: "Salir", fr: "Quitter", de: "Verlassen", pt: "Sair" },
  "header.membersLabel": {
    en: "Party members",
    ja: "パーティーメンバー",
    zh: "队伍成员",
    ko: "파티 멤버",
    es: "Miembros del grupo",
    fr: "Membres du groupe",
    de: "Gruppenmitglieder",
    pt: "Membros do grupo",
  },
  "header.leaveConfirmTitle": {
    en: "Leave this party?",
    ja: "このパーティーを離れますか？",
    zh: "要离开这支队伍吗？",
    ko: "이 파티를 나가시겠습니까?",
    es: "¿Abandonar este grupo?",
    fr: "Quitter ce groupe ?",
    de: "Diese Gruppe verlassen?",
    pt: "Sair deste grupo?",
  },
  "header.leaveConfirmBody": {
    en: "You can rejoin anytime with the invite scroll.",
    ja: "招待の巻物があればいつでも再入室できます。",
    zh: "你可以随时用邀请卷轴重新加入。",
    ko: "초대 두루마리가 있으면 언제든 다시 참여할 수 있어요.",
    es: "Puedes volver a entrar cuando quieras con el pergamino de invitación.",
    fr: "Vous pouvez revenir à tout moment avec le parchemin d'invitation.",
    de: "Mit der Einladungsrolle kannst du jederzeit wieder beitreten.",
    pt: "Você pode reentrar quando quiser com o pergaminho de convite.",
  },
  "header.leaveConfirmYes": { en: "Leave", ja: "退室する", zh: "离开", ko: "나가기", es: "Salir", fr: "Quitter", de: "Verlassen", pt: "Sair" },
  "header.leaveConfirmCancel": { en: "Stay", ja: "とどまる", zh: "留下", ko: "남기", es: "Quedarse", fr: "Rester", de: "Bleiben", pt: "Ficar" },
  "header.you": { en: "you", ja: "あなた", zh: "你", ko: "나", es: "tú", fr: "toi", de: "du", pt: "você" },

  "error.title": {
    en: "The scrying glass cracked",
    ja: "水晶球にひびが入った",
    zh: "占卜水晶出现了裂痕",
    ko: "수정 구슬에 금이 갔습니다",
    es: "El cristal de adivinación se agrietó",
    fr: "Le cristal de divination s'est fêlé",
    de: "Die Wahrsagekugel ist gesprungen",
    pt: "O cristal de vidência rachou",
  },
  "error.body": {
    en: "Something went wrong. Try reloading the chronicle.",
    ja: "何か問題が発生しました。年代記を再読み込みしてください。",
    zh: "出了点问题，请尝试重新加载年代记。",
    ko: "문제가 발생했습니다. 연대기를 다시 불러와 보세요.",
    es: "Algo salió mal. Intenta recargar la crónica.",
    fr: "Une erreur est survenue. Essayez de recharger la chronique.",
    de: "Etwas ist schiefgelaufen. Lade die Chronik neu.",
    pt: "Algo deu errado. Tente recarregar a crônica.",
  },
  "error.reload": { en: "Reload", ja: "再読み込み", zh: "重新加载", ko: "새로고침", es: "Recargar", fr: "Recharger", de: "Neu laden", pt: "Recarregar" },
});
