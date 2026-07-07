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
});
