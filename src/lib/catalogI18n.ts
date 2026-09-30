/**
 * Marathi translations for catalogue text that lives in the database
 * (service names, package labels, task types, inclusions, exclusions,
 * descriptions, segments and categories).
 *
 * Lookup is by the exact English source string, case-insensitive and
 * whitespace-tolerant. Anything without a translation falls through
 * unchanged, so new catalogue rows never break the screen.
 */

const MR: Record<string, string> = {
  /* ---------------- Segments / categories ---------------- */
  "home care": "घरगुती सेवा",
  "auto care": "वाहन सेवा",
  "festival special cleaning": "सण स्पेशल स्वच्छता",
  "courier delivery": "कुरिअर डिलिव्हरी",
  "bulk delivery": "मोठ्या प्रमाणात डिलिव्हरी",
  store: "दुकान",
  services: "सेवा",
  courier: "कुरिअर",

  /* ---------------- Service names ---------------- */
  "home cleaning": "घर स्वच्छता",
  "car / bike wash": "कार व बाईक वॉश",
  "car/bike wash": "कार व बाईक वॉश",
  "festival special": "सण स्पेशल",

  /* ---------------- Package / duration labels ---------------- */
  "1 hour": "१ तास",
  "2 hours": "२ तास",
  "3 hours": "३ तास",
  "4 hours": "४ तास",
  "half day (4 hour)": "अर्धा दिवस (४ तास)",
  "half day (4 hours)": "अर्धा दिवस (४ तास)",
  "full day (8 hours)": "पूर्ण दिवस (८ तास)",
  "full day (8 hour)": "पूर्ण दिवस (८ तास)",
  "car wash": "कार वॉश",
  "bike wash": "बाईक वॉश",
  "combo wash": "कॉम्बो वॉश",

  /* ---------------- Task types ---------------- */
  "house cleaning": "घर स्वच्छता",
  "dusting & wiping": "धूळ झटकणे व पुसणे",
  "cleaning dishes": "भांडी घासणे व धुणे",
  "bathroom cleaning": "बाथरूम स्वच्छता",
  "special instructions": "महत्त्वाच्या सूचना",

  /* ---------------- House cleaning ---------------- */
  "sweeping and mopping floors": "फरशी झाडणे व पुसणे",
  "cleaning kitchen counters": "किचन ओटा स्वच्छ करणे",
  "basic tidying of rooms": "खोल्या आवरून नीटनेटक्या करणे",
  "change or rearrange exisiting bedding": "अंथरूण-पांघरूण बदलणे किंवा नीट लावणे",
  "change or rearrange existing bedding": "अंथरूण-पांघरूण बदलणे किंवा नीट लावणे",
  "dispose wet and dry household waste": "घरातील ओला व सुका कचरा टाकणे",
  "deep stain removal": "जुने व कठीण डाग काढणे",
  "exterior windows": "बाहेरील बाजूच्या खिडक्या",
  "cleaning unsafe or inaccessible areas": "धोकादायक किंवा पोहोचता न येणाऱ्या जागा साफ करणे",
  "moving heavy furniture or appliances": "जड फर्निचर किंवा उपकरणे हलवणे",
  "cleaning outside home areas": "घराबाहेरील परिसर साफ करणे",
  "child, elderly, pet or medical care": "लहान मुले, वृद्ध, पाळीव प्राणी किंवा रुग्णसेवा",

  /* ---------------- Dusting & wiping ---------------- */
  "dusting shelves and furniture": "कपाटे व फर्निचरवरील धूळ साफ करणे",
  "wipe counters, tables & decor": "ओटा, टेबल व सजावटीच्या वस्तू पुसणे",
  "clean appliance exteriors": "उपकरणांचा बाहेरील भाग स्वच्छ करणे",
  "remove accessible cobwebs": "हाताला पोहोचणारी जळमटे काढणे",
  "clean interior windows sills/grills": "आतील खिडक्यांच्या कट्ट्या व ग्रिल स्वच्छ करणे",
  "dusting ceilings or high areas": "छत किंवा उंचावरील भाग साफ करणे",
  "chandeliers or fragile items": "झुंबर किंवा नाजूक वस्तू",
  "exterior grills/windos": "बाहेरील ग्रिल व खिडक्या",
  "exterior grills/windows": "बाहेरील ग्रिल व खिडक्या",
  "stain removal or restoration": "डाग काढणे किंवा पुन्हा नवीन करणे",

  /* ---------------- Cleaning dishes ---------------- */
  "wash regular household utensils": "घरातील रोजची भांडी घासणे व धुणे",
  "scrub and clean the kitchen sink": "किचन सिंक घासून स्वच्छ करणे",
  "clean burners & wipe stove top": "गॅस बर्नर स्वच्छ करणे व शेगडी पुसणे",
  "dispose wet/dry kitchen waste": "किचनमधील ओला व सुका कचरा टाकणे",
  "leave sink area clean and dry": "सिंकचा परिसर स्वच्छ व कोरडा ठेवणे",
  "chimney, degreasing or duct cleaning": "चिमणी, तेलकटपणा किंवा डक्ट साफसफाई",
  "cleaning inside of electrical appliances": "विद्युत उपकरणांचा आतील भाग साफ करणे",
  "heavy scrubbing of burnt/old deposits": "जळालेले किंवा जुने थर जोर लावून घासणे",
  "handling broken glass/sharp waste": "फुटलेली काच किंवा धारदार कचरा हाताळणे",
  "no specialised cookware handling": "विशेष प्रकारची महागडी भांडी हाताळली जाणार नाहीत",

  /* ---------------- Bathroom cleaning ---------------- */
  "clean mirrors and reachable walls": "आरसे व हाताला पोहोचणाऱ्या भिंती स्वच्छ करणे",
  "clean ec (rim, seat, and lid)": "कमोड (कडा, सीट व झाकण) स्वच्छ करणे",
  "scrub sinks and wipe fittings": "बेसिन घासणे व नळ-फिटिंग पुसणे",
  "mop and dry the bathroom floor": "बाथरूमची फरशी पुसून कोरडी करणे",
  "basic surface clean in bathroom": "बाथरूममधील वरवरची स्वच्छता",
  "hard stains, grouts or acid wash": "कठीण डाग, फरशीतील सांधे किंवा ॲसिड वॉश",
  "cleaning ceilings and exhausts": "छत व एक्झॉस्ट फॅन साफ करणे",
  "no drain unclogging/dismantling": "ड्रेनेज उघडणे किंवा तोडून साफ करणे नाही",
  "handling biohazard waste": "जैव-धोकादायक कचरा हाताळणे",
  "no electrical or open wiring work": "विजेचे किंवा उघड्या वायरिंगचे काम नाही",

  /* ---------------- Special instructions ---------------- */
  "badiyos experts are identity/kyc verified and approved before accepting bookings.":
    "बडियोस एक्स्पर्ट्सची ओळख व केवायसी पडताळणी करूनच त्यांना बुकिंग स्वीकारण्यास मान्यता दिली जाते.",
  "please ensure the work area is safe, accessible and free from hazardous or obstructive items.":
    "कामाची जागा सुरक्षित, सहज पोहोचण्याजोगी आणि धोकादायक किंवा अडथळा करणाऱ्या वस्तूंपासून मुक्त ठेवावी.",
  "customers should remain available or provide an authorized contact during the service.":
    "सेवेच्या वेळी ग्राहकाने उपलब्ध राहावे किंवा अधिकृत व्यक्तीचा संपर्क क्रमांक द्यावा.",
  "please secure cash, jewellery, important documents, electronics and other valuable items before the expert arrives.":
    "एक्स्पर्ट येण्यापूर्वी रोख रक्कम, दागिने, महत्त्वाची कागदपत्रे, इलेक्ट्रॉनिक व इतर मौल्यवान वस्तू सुरक्षित ठेवाव्यात.",
  "inform the expert in advance about fragile items, pets, sensitive surfaces, special cleaning requirements or restricted areas.":
    "नाजूक वस्तू, पाळीव प्राणी, संवेदनशील पृष्ठभाग, विशेष स्वच्छतेच्या गरजा किंवा प्रवेश बंदी असलेल्या जागांबद्दल एक्स्पर्टला आधीच कळवावे.",
  "badiyos is not responsible for loss of cash, jewellery, documents or other valuables that are left unsecured or unattended at the service location.":
    "सेवेच्या ठिकाणी असुरक्षित किंवा लक्ष न ठेवता ठेवलेल्या रोख रक्कम, दागिने, कागदपत्रे किंवा मौल्यवान वस्तूंच्या नुकसानीस बडियोस जबाबदार राहणार नाही.",
  "badiyos is not responsible for damage or defects that existed before the service started.":
    "सेवा सुरू होण्यापूर्वीपासून असलेल्या नुकसानीस किंवा दोषांस बडियोस जबाबदार राहणार नाही.",
  "experts are not responsible for moving, handling or safeguarding valuable/personal belongings unless specifically agreed as part of the service.":
    "विशेष ठरल्याशिवाय मौल्यवान किंवा वैयक्तिक वस्तू हलवणे, हाताळणे किंवा सांभाळणे यास एक्स्पर्ट जबाबदार नाहीत.",
  "experts will not handle hazardous, toxic, explosive, biohazardous or otherwise unsafe materials.":
    "धोकादायक, विषारी, स्फोटक, जैव-धोकादायक किंवा असुरक्षित पदार्थ एक्स्पर्ट हाताळणार नाहीत.",
  "please secure all valuables before the service begins. badiyos does not encourage experts to handle cash, jewellery or other high-value personal belongings.":
    "सेवा सुरू होण्यापूर्वी सर्व मौल्यवान वस्तू सुरक्षित ठेवाव्यात. रोख रक्कम, दागिने किंवा इतर महागड्या वैयक्तिक वस्तू हाताळण्यास बडियोस एक्स्पर्ट्सना प्रोत्साहन देत नाही.",

  /* ---------------- Car / bike wash ---------------- */
  "exterior foam wash": "बाहेरील बाजूचा फोम वॉश",
  "tyre & wheel-arch cleaning": "टायर व चाकांभोवतीचा भाग स्वच्छ करणे",
  "interior vacuuming": "आतील भागाची व्हॅक्यूम साफसफाई",
  "dashboard wipe-down": "डॅशबोर्ड पुसून स्वच्छ करणे",
  "dry-wipe finish": "कोरड्या कापडाने पुसून फिनिशिंग",
  "expert brings own machinery, chemicals & equipment":
    "एक्स्पर्ट स्वतःची मशिनरी, केमिकल्स व साधने घेऊन येतात",
  "water, electricity & bucket to be provided by customer":
    "पाणी, वीज व बादली ग्राहकाने पुरवावी",
  "seat shampooing / deep upholstery cleaning": "सीट शॅम्पू / आतील कव्हरची सखोल स्वच्छता",
  "ac vent deep cleaning": "एसी व्हेंटची सखोल स्वच्छता",
  "engine bay cleaning": "इंजिन भागाची स्वच्छता",
  "chain lubrication / servicing": "चेनला ऑइलिंग / सर्व्हिसिंग",
  "interior seat cleaning (bike has no interior)":
    "आतील सीट स्वच्छता (बाईकला आतील भाग नसतो)",
  "car: exterior foam wash, tyre & wheel-arch cleaning":
    "कार: बाहेरील फोम वॉश, टायर व चाकांभोवतीचा भाग स्वच्छ करणे",
  "car: interior vacuuming, dashboard wipe-down":
    "कार: आतील व्हॅक्यूम साफसफाई, डॅशबोर्ड पुसणे",
  "bike: exterior foam wash, chain & wheel cleaning":
    "बाईक: बाहेरील फोम वॉश, चेन व चाके स्वच्छ करणे",
  "car: seat shampooing / deep upholstery cleaning":
    "कार: सीट शॅम्पू / आतील कव्हरची सखोल स्वच्छता",
  "car: ac vent deep cleaning, engine bay cleaning":
    "कार: एसी व्हेंटची सखोल स्वच्छता, इंजिन भागाची स्वच्छता",
  "bike: chain lubrication / servicing": "बाईक: चेनला ऑइलिंग / सर्व्हिसिंग",

  /* ---------------- Home cleaning exclusions ---------------- */
  "please provide all necessary equipments for the experts":
    "कृपया एक्स्पर्टसाठी लागणारी सर्व आवश्यक साधने उपलब्ध करून द्यावीत",

  /* ---------------- Descriptions ---------------- */
  "a focused 60-minute cleaning session by 1 badiyos expert — perfect for quick touch-ups before guests arrive or a light refresh of your main living areas.\n\nnote: this service is performed by a single expert. images shown are for illustration only and do not represent the number of staff assigned.":
    "१ बडियोस एक्स्पर्टकडून ६० मिनिटांची नेमकी स्वच्छता सेवा — पाहुणे येण्यापूर्वी झटपट आवराआवर किंवा मुख्य खोल्यांच्या हलक्या स्वच्छतेसाठी योग्य.\n\nसूचना: ही सेवा एकाच एक्स्पर्टकडून केली जाते. दाखवलेली छायाचित्रे केवळ प्रातिनिधिक असून त्यातून कर्मचाऱ्यांची संख्या दर्शवली जात नाही.",
  "a thorough 120-minute deep-cleaning session by 1 badiyos expert — covers dusting, mopping, kitchen surfaces, and bathroom cleaning for a genuinely fresh home.\n\nnote: this service is performed by a single expert. images shown are for illustration only and do not represent the number of staff assigned.":
    "१ बडियोस एक्स्पर्टकडून १२० मिनिटांची सखोल स्वच्छता — धूळ साफ करणे, फरशी पुसणे, किचनचे पृष्ठभाग व बाथरूम स्वच्छता यांचा समावेश, घर खऱ्या अर्थाने ताजेतवाने होण्यासाठी.\n\nसूचना: ही सेवा एकाच एक्स्पर्टकडून केली जाते. दाखवलेली छायाचित्रे केवळ प्रातिनिधिक असून त्यातून कर्मचाऱ्यांची संख्या दर्शवली जात नाही.",
  "our most complete cleaning package — 180 minutes with 1 dedicated badiyos expert, covering every room, deep surface cleaning, kitchen, bathrooms, and organizing — ideal for larger homes or festival/guest prep.\n\nnote: this service is performed by a single expert. images shown are for illustration only and do not represent the number of staff assigned.":
    "आमचे सर्वात परिपूर्ण स्वच्छता पॅकेज — १ समर्पित बडियोस एक्स्पर्टसह १८० मिनिटे, प्रत्येक खोली, पृष्ठभागांची सखोल स्वच्छता, किचन, बाथरूम व आवराआवर — मोठ्या घरांसाठी किंवा सण/पाहुण्यांच्या तयारीसाठी उत्तम.\n\nसूचना: ही सेवा एकाच एक्स्पर्टकडून केली जाते. दाखवलेली छायाचित्रे केवळ प्रातिनिधिक असून त्यातून कर्मचाऱ्यांची संख्या दर्शवली जात नाही.",
  "a half-day cleaning session by 1 badiyos expert, specially designed for dussehra and diwali preparations — with 4 hours of dedicated cleaning time. perfect for deep cleaning and getting your home festival-ready before the celebrations begin.":
    "१ बडियोस एक्स्पर्टकडून अर्ध्या दिवसाची स्वच्छता सेवा, खास दसरा व दिवाळीच्या तयारीसाठी — ४ तासांचा पूर्ण वेळ फक्त स्वच्छतेसाठी. सणाआधी घराची सखोल स्वच्छता करून ते सणासाठी सज्ज करण्यासाठी उत्तम.",
  "a full-day cleaning session by 1 badiyos expert, specially designed for dussehra and diwali preparations — with 8 hours of dedicated cleaning time and a 30-minute lunch break. perfect for deep cleaning and getting your home festival-ready before the celebrations begin.":
    "१ बडियोस एक्स्पर्टकडून पूर्ण दिवसाची स्वच्छता सेवा, खास दसरा व दिवाळीच्या तयारीसाठी — ८ तासांचा पूर्ण वेळ फक्त स्वच्छतेसाठी आणि ३० मिनिटांची जेवणाची सुट्टी. सणाआधी घराची सखोल स्वच्छता करून ते सणासाठी सज्ज करण्यासाठी उत्तम.",
  "a thorough car wash at your doorstep — exterior foam wash, tyre and wheel-arch cleaning, plus interior vacuuming and dashboard wipe-down, by 1 badiyos expert for a complete inside-out clean.\n\nwhat you need to provide: water, electricity connection, and a bucket. all cleaning machinery, chemicals, and equipment will be brought by the expert.\n\nnote: this service is performed by a single expert. images shown are for illustration only and do not represent the number of staff assigned.":
    "तुमच्या दारात संपूर्ण कार वॉश — बाहेरील फोम वॉश, टायर व चाकांभोवतीची स्वच्छता, तसेच आतील व्हॅक्यूम साफसफाई व डॅशबोर्ड पुसणे, १ बडियोस एक्स्पर्टकडून आतून-बाहेरून पूर्ण स्वच्छतेसाठी.\n\nतुम्ही काय पुरवायचे: पाणी, वीज जोडणी व बादली. सर्व मशिनरी, केमिकल्स व साधने एक्स्पर्ट घेऊन येतील.\n\nसूचना: ही सेवा एकाच एक्स्पर्टकडून केली जाते. दाखवलेली छायाचित्रे केवळ प्रातिनिधिक असून त्यातून कर्मचाऱ्यांची संख्या दर्शवली जात नाही.",
  "a complete exterior wash for your two-wheeler at your doorstep — foam wash, chain and wheel cleaning, and a quick dry-wipe finish by 1 badiyos expert.\n\nwhat you need to provide: water, electricity connection, and a bucket. all cleaning machinery, chemicals, and equipment will be brought by the expert.\n\nnote: this service is performed by a single expert. images shown are for illustration only and do not represent the number of staff assigned.":
    "तुमच्या दुचाकीसाठी दारातच संपूर्ण बाहेरील वॉश — फोम वॉश, चेन व चाके स्वच्छ करणे आणि १ बडियोस एक्स्पर्टकडून झटपट कोरड्या कापडाने फिनिशिंग.\n\nतुम्ही काय पुरवायचे: पाणी, वीज जोडणी व बादली. सर्व मशिनरी, केमिकल्स व साधने एक्स्पर्ट घेऊन येतील.\n\nसूचना: ही सेवा एकाच एक्स्पर्टकडून केली जाते. दाखवलेली छायाचित्रे केवळ प्रातिनिधिक असून त्यातून कर्मचाऱ्यांची संख्या दर्शवली जात नाही.",
  "get your car and bike washed together in one visit — full exterior wash plus interior vacuuming and dashboard wipe-down for your car, and a complete exterior wash with chain and wheel cleaning for your bike, all done back-to-back at your doorstep by 1 badiyos expert, at a combined price lower than booking separately.\n\nwhat you need to provide: water, electricity connection, and a bucket. all cleaning machinery, chemicals, and equipment will be brought by the expert.\n\nnote: this service is performed by a single expert. images shown are for illustration only and do not represent the number of staff assigned.":
    "एकाच भेटीत कार व बाईक दोन्ही धुवून घ्या — कारसाठी संपूर्ण बाहेरील वॉश, आतील व्हॅक्यूम साफसफाई व डॅशबोर्ड पुसणे, तसेच बाईकसाठी संपूर्ण बाहेरील वॉश, चेन व चाके स्वच्छ करणे; हे सर्व १ बडियोस एक्स्पर्टकडून तुमच्या दारात लागोपाठ, वेगवेगळे बुक करण्यापेक्षा कमी एकत्रित दरात.\n\nतुम्ही काय पुरवायचे: पाणी, वीज जोडणी व बादली. सर्व मशिनरी, केमिकल्स व साधने एक्स्पर्ट घेऊन येतील.\n\nसूचना: ही सेवा एकाच एक्स्पर्टकडून केली जाते. दाखवलेली छायाचित्रे केवळ प्रातिनिधिक असून त्यातून कर्मचाऱ्यांची संख्या दर्शवली जात नाही.",
};

/** Marathi label for a booking status coming from the database. */
const STATUS_MR: Record<string, string> = {
  pending: "प्रतीक्षेत",
  confirmed: "निश्चित झाले",
  accepted: "स्वीकारले",
  expert_assigned: "एक्स्पर्ट नेमला",
  on_the_way: "निघाल्या आहेत",
  arrived: "पोहोचल्या आहेत",
  in_progress: "काम चालू",
  completed: "पूर्ण झाले",
  cancelled: "रद्द झाले",
  rejected: "नाकारले",
};

const STATUS_EN: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  accepted: "Accepted",
  expert_assigned: "Expert Assigned",
  on_the_way: "On The Way",
  arrived: "Arrived",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Translates a single catalogue string. Unknown text is returned unchanged.
 */
export function translateCatalog(value: string | null | undefined, lang: string): string {
  if (!value) return value ?? "";
  if (lang !== "mr") return value;
  // Descriptions keep their paragraph breaks, so try the raw form first.
  const direct = MR[value.trim().toLowerCase()];
  if (direct) return direct;
  return MR[normalise(value)] ?? value;
}

/** Translates every entry of a catalogue list. */
export function translateCatalogList(
  values: readonly string[] | null | undefined,
  lang: string,
): string[] {
  return (values ?? []).map((v) => translateCatalog(v, lang));
}

/** Human-readable booking status in the active language. */
export function translateStatus(status: string, lang: string): string {
  const key = status?.trim().toLowerCase();
  if (lang === "mr" && STATUS_MR[key]) return STATUS_MR[key];
  if (STATUS_EN[key]) return STATUS_EN[key];
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
