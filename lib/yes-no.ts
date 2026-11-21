// Spoken confirmation. "No" wins over "yes" so a hesitant answer never saves.
const NO = ["కాదు", "వద్దు", "లేదు", "ఆగు", "ఆపు", "రద్దు", "మార్చు", "నహీ", "नहीं", "मत", "no", "nope", "cancel", "stop", "wrong", "nahi", "nahin", "vaddu", "kaadu", "ledu", "galat", "change"];
const YES = ["అవును", "ఔను", "సరే", "సరి", "హా", "ఓకే", "చేయి", "సేవ్", "కరెక్ట్", "हाँ", "हां", "ठीक", "yes", "yeah", "yep", "ok", "okay", "save", "correct", "right", "haan", "ha", "han", "avunu", "aunu", "sare", "sari", "theek", "thik"];

export function heardYesNo(text: string): "yes" | "no" | undefined {
  const words = text.normalize("NFC").toLocaleLowerCase().replace(/[.,!?।"'“”‘’]/g, " ").split(/\s+/).filter(Boolean);
  const has = (list: string[]) => words.some((word) => list.some((target) => word === target || (target.length > 2 && word.startsWith(target))));
  if (has(NO)) return "no";
  if (has(YES)) return "yes";
  return undefined;
}
