// Common/shared translations: tab labels, generic actions, rank titles,
// error strings, diary moods. Feature-specific strings live in each
// feature's own `<feature>.i18n.ts` (see i18n.ts's module doc comment).
import { registerTranslations } from "./i18n";

registerTranslations({
  // --- tab bar (fantasy-flavored screen names, see docs/DESIGN.md) -------
  "tab.map": {
    en: "World Atlas", ja: "世界地図", zh: "世界地图", ko: "세계 지도",
    es: "Atlas Mundial", fr: "Atlas du Monde", de: "Weltatlas", pt: "Atlas Mundial",
  },
  "tab.album": {
    en: "Memory Grimoire", ja: "思い出の魔導書", zh: "记忆魔法书", ko: "추억의 마도서",
    es: "Grimorio de Recuerdos", fr: "Grimoire des Souvenirs", de: "Erinnerungsgrimoire", pt: "Grimório de Memórias",
  },
  "tab.diary": {
    en: "Traveler's Journal", ja: "旅人の日記", zh: "旅人日记", ko: "여행자의 일기",
    es: "Diario del Viajero", fr: "Journal du Voyageur", de: "Reisetagebuch", pt: "Diário do Viajante",
  },
  "tab.camera": {
    en: "Summoning Circle", ja: "召喚の陣", zh: "召唤法阵", ko: "소환의 진",
    es: "Círculo de Invocación", fr: "Cercle d'Invocation", de: "Beschwörungskreis", pt: "Círculo de Invocação",
  },
  "tab.guild": {
    en: "Guild Card", ja: "ギルドカード", zh: "公会卡", ko: "길드 카드",
    es: "Tarjeta de Gremio", fr: "Carte de Guilde", de: "Gildenkarte", pt: "Cartão da Guilda",
  },

  // --- generic actions -----------------------------------------------------
  "common.save": { en: "Save", ja: "保存", zh: "保存", ko: "저장", es: "Guardar", fr: "Enregistrer", de: "Speichern", pt: "Salvar" },
  "common.cancel": { en: "Cancel", ja: "キャンセル", zh: "取消", ko: "취소", es: "Cancelar", fr: "Annuler", de: "Abbrechen", pt: "Cancelar" },
  "common.delete": { en: "Delete", ja: "削除", zh: "删除", ko: "삭제", es: "Eliminar", fr: "Supprimer", de: "Löschen", pt: "Excluir" },
  "common.close": { en: "Close", ja: "閉じる", zh: "关闭", ko: "닫기", es: "Cerrar", fr: "Fermer", de: "Schließen", pt: "Fechar" },
  "common.back": { en: "Back", ja: "戻る", zh: "返回", ko: "뒤로", es: "Atrás", fr: "Retour", de: "Zurück", pt: "Voltar" },
  "common.share": { en: "Share", ja: "共有", zh: "分享", ko: "공유", es: "Compartir", fr: "Partager", de: "Teilen", pt: "Compartilhar" },
  "common.retry": { en: "Retry", ja: "再試行", zh: "重试", ko: "다시 시도", es: "Reintentar", fr: "Réessayer", de: "Erneut versuchen", pt: "Tentar novamente" },

  // --- adventurer rank titles (see gamification.ts's rank bands) -----------
  "rank.wanderer": { en: "Wanderer", ja: "放浪者", zh: "流浪者", ko: "방랑자", es: "Errante", fr: "Vagabond", de: "Wanderer", pt: "Errante" },
  "rank.pathfinder": { en: "Pathfinder", ja: "道探し", zh: "探路者", ko: "길잡이", es: "Explorador", fr: "Éclaireur", de: "Pfadfinder", pt: "Desbravador" },
  "rank.voyager": { en: "Voyager", ja: "旅する者", zh: "航行者", ko: "항해자", es: "Viajero", fr: "Voyageur", de: "Reisender", pt: "Viajante" },
  "rank.cartographer": {
    en: "Master Cartographer", ja: "大地図製作者", zh: "大制图师", ko: "대지도 제작자",
    es: "Maestro Cartógrafo", fr: "Maître Cartographe", de: "Meisterkartograf", pt: "Mestre Cartógrafo",
  },
  "rank.legend": {
    en: "Living Legend", ja: "生ける伝説", zh: "活传奇", ko: "살아있는 전설",
    es: "Leyenda Viviente", fr: "Légende Vivante", de: "Lebende Legende", pt: "Lenda Viva",
  },

  // --- errors ------------------------------------------------------------
  "error.connection": {
    en: "Connection error", ja: "接続エラー", zh: "连接错误", ko: "연결 오류",
    es: "Error de conexión", fr: "Erreur de connexion", de: "Verbindungsfehler", pt: "Erro de conexão",
  },
  "error.cameraPermission": {
    en: "Camera permission needed", ja: "カメラの許可が必要です", zh: "需要相机权限", ko: "카메라 권한이 필요합니다",
    es: "Se necesita permiso de cámara", fr: "Autorisation de caméra requise", de: "Kamerazugriff erforderlich", pt: "Permissão de câmera necessária",
  },

  // --- diary moods ---------------------------------------------------------
  "mood.triumphant": { en: "Triumphant", ja: "勝利の", zh: "凯旋的", ko: "승리에 찬", es: "Triunfante", fr: "Triomphant", de: "Triumphierend", pt: "Triunfante" },
  "mood.merry": { en: "Merry", ja: "陽気な", zh: "欢乐的", ko: "즐거운", es: "Alegre", fr: "Joyeux", de: "Fröhlich", pt: "Alegre" },
  "mood.weary": { en: "Weary", ja: "疲れた", zh: "疲惫的", ko: "지친", es: "Cansado", fr: "Fatigué", de: "Erschöpft", pt: "Cansado" },
  "mood.wistful": { en: "Wistful", ja: "もの悲しい", zh: "惆怅的", ko: "아련한", es: "Nostálgico", fr: "Nostalgique", de: "Wehmütig", pt: "Nostálgico" },
  "mood.inspired": { en: "Inspired", ja: "感化された", zh: "受启发的", ko: "영감을 받은", es: "Inspirado", fr: "Inspiré", de: "Inspiriert", pt: "Inspirado" },
});
