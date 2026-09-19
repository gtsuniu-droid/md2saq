/** Fixed presentation vocabulary. Not editable from the UI. */
export interface Presentation {
  id: string;
  name: string;
  /** Lower-case keywords used for auto-suggestion at import. */
  synonyms: string[];
  /** Parent presentation id for sub-presentations. */
  parent?: string;
  /** Trial: a small picture for lists. */
  emoji?: string;
}

const EMOJI: Record<string, string> = {
  "abdominal-pain": "🫃",
  "abnormal-speech": "🗣️",
  "altered-bowel-habit": "🚽",
  "altered-sleep": "😴",
  "altered-urinary-volume": "💧",
  "cognitive-impairment": "🧩",
  "chest-pain": "🫀",
  "confusion": "😵‍💫",
  "constipation": "🧱",
  "cough": "😮‍💨",
  "diarrhoea": "🌊",
  "dizziness": "🌀",
  "dysphagia": "🥄",
  "dyspnoea": "🫁",
  "falls": "🤸",
  "fertility-visit": "🤰",
  "fever": "🌡️",
  "haematemesis": "🩸",
  "haematuria": "🩸",
  "haemoptysis": "🩸",
  "headache": "🤕",
  "hearing-loss": "👂",
  "high-blood-pressure": "📈",
  "jaundice": "💛",
  "joint-pain": "🦴",
  "joint-swelling": "🦵",
  "lack-of-energy": "🔋",
  "loss-of-consciousness": "😵",
  "low-blood-pressure": "📉",
  "muscle-weakness": "💪",
  "musculoskeletal-pain": "🩻",
  "back-pain": "🧍",
  "palpitations": "💓",
  "polydipsia": "🥤",
  "rectal-bleeding": "🩸",
  "sensory-disturbance": "🫳",
  "sore-throat": "🗣️",
  "swelling": "🎈",
  "trauma": "🚑",
  "tremor": "🫨",
  "urinary-symptoms": "🚻",
  "vision-loss": "👁️",
  "vomiting": "🤢",
  "weight-gain": "⚖️",
  "weight-loss": "📏",
  "wheeze-stridor": "🌬️",
  "wounds": "🩹",
};

const p = (id: string, name: string, synonyms: string[] = [], parent?: string): Presentation => ({
  id,
  name,
  synonyms: synonyms.map((s) => s.toLowerCase()),
  parent,
  emoji: EMOJI[id],
});

export const PRESENTATIONS: Presentation[] = [
  p("abdominal-pain", "Abdominal pain", ["abdominal pain", "abdo pain", "epigastric", "flank pain", "riF", "rif pain", "lif pain", "ruq", "luq", "suprapubic", "peritonitis", "peritonism"]),
  p("abnormal-speech", "Abnormal speech and communication", ["speech", "dysarthria", "dysphasia", "aphasia", "slurred", "unclear communication"]),
  p("altered-bowel-habit", "Altered bowel habit", ["bowel habit", "change in bowel", "altered bowel"]),
  p("altered-sleep", "Altered sleep", ["sleep", "insomnia", "hypersomnia", "snoring", "sleep apnoea", "obstructive sleep"]),
  p("altered-urinary-volume", "Altered urinary volume", ["anuria", "oliguria", "polyuria", "urine output", "urinary volume"]),
  p("cognitive-impairment", "Cognitive impairment", ["cognitive", "dementia", "memory loss", "forgetful", "mmse", "moca"]),
  p("chest-pain", "Chest pain", ["chest pain", "chest tightness", "angina", "pleuritic"]),
  p("confusion", "Confusion", ["confusion", "confused", "delirium", "delirious", "disorientated", "disoriented"]),
  p("constipation", "Constipation", ["constipation", "constipated", "obstipation"]),
  p("cough", "Cough", ["cough", "coughing", "productive cough"]),
  p("diarrhoea", "Diarrhoea", ["diarrhoea", "diarrhea", "loose stools", "loose stool"]),
  p("dizziness", "Dizziness", ["dizziness", "dizzy", "vertigo", "lightheaded", "light-headed", "presyncope"]),
  p("dysphagia", "Dysphagia", ["dysphagia", "difficulty swallowing", "odynophagia"]),
  p("dyspnoea", "Dyspnoea", ["dyspnoea", "dyspnea", "shortness of breath", "short of breath", "breathless", "sob", "orthopnoea"]),
  p("falls", "Falls", ["fall", "falls", "fell", "mechanical fall"]),
  p("fertility-visit", "Fertility visit", ["fertility", "subfertility", "infertility", "trying to conceive", "ivf"]),
  p("fever", "Fever", ["fever", "febrile", "pyrexia", "temperature of", "rigors", "sepsis"]),
  p("haematemesis", "Haematemesis", ["haematemesis", "hematemesis", "vomiting blood", "coffee ground", "coffee-ground"]),
  p("haematuria", "Haematuria", ["haematuria", "hematuria", "blood in urine", "blood in the urine"]),
  p("haemoptysis", "Haemoptysis", ["haemoptysis", "hemoptysis", "coughing up blood", "coughing blood"]),
  p("headache", "Headache", ["headache", "migraine", "thunderclap", "head ache"]),
  p("hearing-loss", "Hearing loss", ["hearing loss", "deafness", "hard of hearing", "tinnitus", "hearing"]),
  p("high-blood-pressure", "High blood pressure", ["hypertension", "hypertensive", "high blood pressure", "elevated blood pressure", "bp of 1"]),
  p("jaundice", "Jaundice", ["jaundice", "jaundiced", "icterus", "yellow", "bilirubin"]),
  p("joint-pain", "Joint pain", ["joint pain", "arthralgia", "arthritis", "hip pain", "knee pain", "neck pain", "shoulder pain", "pelvic instability", "sacroiliac", "painful joint"]),
  p("joint-swelling", "Joint swelling", ["joint swelling", "swollen joint", "swollen knee", "effusion", "hot swollen"]),
  p("lack-of-energy", "Lack of energy", ["lethargy", "lethargic", "fatigue", "fatigued", "tiredness", "tired", "malaise", "lack of energy", "low energy", "non-specific"]),
  p("loss-of-consciousness", "Loss of consciousness", ["loss of consciousness", "unconscious", "syncope", "collapse", "collapsed", "blackout", "black out", "transient loss", "anaesthetised", "gcs", "unresponsive"]),
  p("low-blood-pressure", "Low blood pressure", ["hypotension", "hypotensive", "low blood pressure", "shock", "shocked"]),
  p("muscle-weakness", "Muscle weakness", ["weakness", "weak", "paresis", "paralysis", "hemiparesis", "myopathy", "foot drop"]),
  p("musculoskeletal-pain", "Musculoskeletal pain", ["musculoskeletal", "bone pain", "muscle ache", "muscle pain", "myalgia", "lower limb pain", "loin pain", "pelvic floor", "perineum", "perineal"]),
  p("back-pain", "Back pain", ["back pain", "lower back", "low back", "lumbar", "sciatica", "cauda equina"], "musculoskeletal-pain"),
  p("palpitations", "Palpitations", ["palpitations", "palpitation", "racing heart", "heart racing", "fluttering", "irregular heartbeat"]),
  p("polydipsia", "Polydipsia", ["polydipsia", "thirst", "thirsty", "drinking a lot"]),
  p("rectal-bleeding", "Rectal bleeding", ["rectal bleeding", "pr bleeding", "pr bleed", "blood in stool", "blood in the stool", "melaena", "melena", "haematochezia", "bleeding from the back passage", "bright red blood"]),
  p("sensory-disturbance", "Sensory disturbance", ["numbness", "numb", "tingling", "paraesthesia", "paresthesia", "pins and needles", "sensory loss", "sensory disturbance", "altered sensation"]),
  p("sore-throat", "Sore throat", ["sore throat", "pharyngitis", "tonsillitis", "throat pain", "odynophagia"]),
  p("swelling", "Swelling", ["swelling", "swollen", "oedema", "edema", "peripheral oedema", "leg swelling", "ankle swelling", "lower limb swelling", "lump"]),
  p("trauma", "Trauma", ["trauma", "laceration", "head injury", "soft tissue injury", "fracture", "fractured", "dislocation", "dislocated", "injury", "injured", "mva", "motor vehicle", "assault", "stabbed", "stab wound"]),
  p("tremor", "Tremor", ["tremor", "shaking", "shaky hands", "parkinson"]),
  p("urinary-symptoms", "Urinary symptoms", ["frequency", "dysuria", "nocturia", "luts", "lower urinary tract", "incontinence", "incontinent", "urgency", "urinary symptoms", "uti", "hesitancy", "poor stream"]),
  p("vision-loss", "Vision loss", ["vision loss", "visual loss", "loss of vision", "blurred vision", "blurry vision", "diplopia", "double vision", "can't see", "cannot see", "visual disturbance", "amaurosis"]),
  p("vomiting", "Vomiting", ["vomiting", "vomit", "nausea", "nauseous", "emesis"]),
  p("weight-gain", "Weight gain", ["weight gain", "gained weight", "gaining weight", "obesity", "obese"]),
  p("weight-loss", "Weight loss", ["weight loss", "lost weight", "losing weight", "cachexia", "unintentional weight"]),
  p("wheeze-stridor", "Wheeze/stridor", ["wheeze", "wheezing", "stridor", "respiratory distress", "noisy breathing", "asthma"]),
  p("wounds", "Wounds", ["wound", "wounds", "ulcer", "ulceration", "pressure injury", "pressure sore", "dehiscence"]),
];

export const PRESENTATION_BY_ID: Map<string, Presentation> = new Map(
  PRESENTATIONS.map((x) => [x.id, x]),
);

export function presentationName(id: string): string {
  return PRESENTATION_BY_ID.get(id)?.name ?? id;
}
