export const EVENT_TYPES = [
  { id: "アリーナダイレクト", label: "アリーナダイレクト", short: "AD" },
  { id: "プレイイン", label: "プレイイン", short: "PI" },
  { id: "リミテッドチャンピオンシップ予選", label: "リミテッドチャンピオンシップ予選", short: "LC予選" },
];

// ジェム換算: 20000ジェム=15000円
// PB BOX 15000円→20000ジェム/箱、CB BOX 45000円→60000ジェム/箱
export const BOX_GEM_VALUE = { PB_BOX: 20000, CB_BOX: 60000 };

export const PRIZE_TYPES = [
  { id: "なし",    label: "なし",                    icon: "✕", color: "#555" },
  { id: "ジェム",  label: "ジェム",                  icon: "💎", color: "#7ecfff" },
  { id: "PB_BOX",  label: "プレイブースターBOX",      icon: "🎁", color: "#f78c6c" },
  { id: "CB_BOX",  label: "コレクターブースターBOX",  icon: "✨", color: "#c792ea" },
  { id: "予選ウィークエンド権利", label: "予選権利",   icon: "🏆", color: "#ffcb6b" },
];
