// Maps an entry to a body region (anatomy extension codes XA..., body-system chapters, and anatomical
// words in titles / index terms) and draws the matching schematic diagram with that region highlighted.
// Diagram source and licence: see ANATOMY_CREDITS (also shown on the About page and under every figure).
import { h } from '../ui/h';
import bodySvg from './body.svg?raw';
import type { Detail } from '../types';

type View = 'surface' | 'back' | 'organs' | 'skeleton';

export const REGIONS: Record<string, { label: string; view: View }> = {
  head: { label: 'Head', view: 'surface' }, face: { label: 'Face', view: 'surface' }, eye: { label: 'Eyes', view: 'surface' },
  ear: { label: 'Ears', view: 'surface' }, nose: { label: 'Nose', view: 'surface' }, mouth: { label: 'Mouth', view: 'surface' },
  neck: { label: 'Neck and throat', view: 'surface' }, shoulder: { label: 'Shoulder', view: 'surface' }, chest: { label: 'Chest', view: 'surface' },
  breast: { label: 'Breast', view: 'surface' }, abdomen: { label: 'Abdomen', view: 'surface' }, pelvis: { label: 'Pelvis and groin', view: 'surface' },
  arm: { label: 'Upper arm', view: 'surface' }, forearm: { label: 'Elbow and forearm', view: 'surface' }, hand: { label: 'Hand', view: 'surface' },
  thigh: { label: 'Thigh', view: 'surface' }, knee: { label: 'Knee', view: 'surface' }, leg: { label: 'Lower leg and ankle', view: 'surface' },
  foot: { label: 'Foot', view: 'surface' }, skin: { label: 'Skin (whole body)', view: 'surface' },
  back: { label: 'Back', view: 'back' }, lumbar: { label: 'Lower back', view: 'back' }, buttock: { label: 'Buttock', view: 'back' },
  brain: { label: 'Brain', view: 'organs' }, nervous: { label: 'Nervous system', view: 'organs' }, thyroid: { label: 'Thyroid', view: 'organs' },
  endocrine: { label: 'Endocrine glands', view: 'organs' }, lung: { label: 'Lungs and airways', view: 'organs' }, heart: { label: 'Heart', view: 'organs' },
  circulatory: { label: 'Heart and blood vessels', view: 'organs' }, liver: { label: 'Liver', view: 'organs' }, stomach: { label: 'Stomach', view: 'organs' },
  pancreas: { label: 'Pancreas', view: 'organs' }, spleen: { label: 'Spleen', view: 'organs' }, kidney: { label: 'Kidneys', view: 'organs' },
  intestine: { label: 'Small intestine', view: 'organs' }, colon: { label: 'Colon and rectum', view: 'organs' }, digestive: { label: 'Digestive system', view: 'organs' },
  bladder: { label: 'Bladder and urinary tract', view: 'organs' }, urinary: { label: 'Urinary system', view: 'organs' }, uterus: { label: 'Uterus and ovaries', view: 'organs' },
  skeleton: { label: 'Skeleton', view: 'skeleton' }, skull: { label: 'Skull', view: 'skeleton' }, spine: { label: 'Spine', view: 'skeleton' },
  ribs: { label: 'Ribs and sternum', view: 'skeleton' }, pelvisbone: { label: 'Pelvic bones', view: 'skeleton' }, shoulderbone: { label: 'Collarbone and shoulder', view: 'skeleton' },
  humerus: { label: 'Upper arm bone', view: 'skeleton' }, forearmbone: { label: 'Forearm bones', view: 'skeleton' }, handbone: { label: 'Hand bones', view: 'skeleton' },
  femur: { label: 'Thigh bone', view: 'skeleton' }, kneebone: { label: 'Kneecap', view: 'skeleton' }, tibia: { label: 'Shin bones', view: 'skeleton' },
  footbone: { label: 'Foot bones', view: 'skeleton' },
};

// Ordered: the first rule that matches a text wins, so specific organs come before generic body parts.
const RULES: [RegExp, string][] = [
  [/\bspinal cord\b|\bmyel(?:itis|opathy)\b/, 'nervous'],
  [/\b(?:brain|cerebr\w*|cerebell\w*|intracranial|encephal\w*|meninge\w*|cortical|hippocamp\w*|pituitary)\b/, 'brain'],
  [/\b(?:eye|eyes|eyelid\w*|ocular|retin\w*|cornea\w*|conjunctiv\w*|lacrimal|optic|uveitis|glaucoma|cataract|strabismus|myopia|vision|visual|orbit\w*|sclera)\b/, 'eye'],
  [/\b(?:ear|ears|otitis|hearing|deaf\w*|tympan\w*|cochlea\w*|mastoid|vestibul\w*|tinnitus|auditory|eustachian)\b/, 'ear'],
  [/\b(?:nose|nasal|nostril|epistaxis|sinus\w*|rhin\w*)\b/, 'nose'],
  [/\b(?:mouth|oral|tooth|teeth|dental|dentition|tongue|gingiv\w*|lip|lips|palate|saliva\w*|stomat\w*|caries|periodont\w*)\b/, 'mouth'],
  [/\b(?:thyroid\w*|goit\w*)\b/, 'thyroid'],
  [/\b(?:lung|lungs|pulmon\w*|bronch\w*|pneumon\w*|pleur\w*|respirat\w*|asthma|emphysema|trachea\w*|alveol\w*|pneumothorax)\b/, 'lung'],
  [/\b(?:throat|pharyn\w*|laryn\w*|tonsil\w*|neck)\b/, 'neck'],
  [/\b(?:heart|cardi\w*|coronary|myocard\w*|atrial|ventricul\w*|mitral|pericard\w*|endocard\w*|angina|arrhythm\w*)\b/, 'heart'],
  [/\b(?:vein|veins|venous|arter\w*|aort\w*|vascular|vessel\w*|thrombo\w*|embol\w*|aneurysm|varic\w*|hypertens\w*|hypotens\w*)\b/, 'circulatory'],
  [/\b(?:liver|hepat\w*|biliary|gallbladder|cholecyst\w*|cholang\w*|cirrhosis|jaundice|bile)\b/, 'liver'],
  [/\b(?:pancrea\w*|insulin|diabet\w*)\b/, 'pancreas'],
  [/\b(?:stomach|gastr\w*|peptic|duoden\w*|dyspepsia|oesophag\w*|esophag\w*|reflux)\b/, 'stomach'],
  [/\b(?:colon|colonic|colitis|rectum|rectal|anus|anal|haemorrhoid\w*|hemorrhoid\w*|diverticul\w*)\b/, 'colon'],
  [/\b(?:intestin\w*|bowel|ileum|ileus|jejun\w*|crohn\w*|appendic\w*|appendix|enteri\w*|diarrh\w*|coeliac|celiac|constipation)\b/, 'intestine'],
  [/\b(?:spleen|splen\w*)\b/, 'spleen'],
  [/\b(?:kidney\w*|renal|nephr\w*|glomerul\w*|ureter\w*|dialysis)\b/, 'kidney'],
  [/\b(?:bladder|urethra\w*|urinary|urine|cystitis|micturition|incontinence)\b/, 'bladder'],
  [/\b(?:uter\w*|ovar\w*|cervix|vagin\w*|vulva\w*|endometri\w*|fallopian|menstrua\w*|pregnan\w*|gestation\w*|labour|obstetric\w*|puerper\w*|placent\w*|fet\w*|menopaus\w*|amenorrh\w*)\b/, 'uterus'],
  [/\b(?:prostat\w*|testi\w*|penis|penile|scrot\w*|epididym\w*|erectile|sperm\w*|semen|genital\w*)\b/, 'pelvis'],
  [/\b(?:breast|breasts|mammary|lactation|nipple)\b/, 'breast'],
  [/\b(?:skull|cranium|craniosynostosis)\b/, 'skull'],
  [/\b(?:vertebr\w*|spine|spinal|scoliosis|kyphosis|lordosis|spondyl\w*|intervertebral)\b/, 'spine'],
  [/\b(?:rib|ribs|sternum)\b/, 'ribs'],
  [/\b(?:sacrum|coccyx|sacroiliac|hip bone)\b/, 'pelvisbone'],
  [/\b(?:clavicle|scapula)\b/, 'shoulderbone'],
  [/\bhumerus\b/, 'humerus'],
  [/\b(?:radius|ulna)\b/, 'forearmbone'],
  [/\b(?:carpal|metacarp\w*|phalang\w*)\b/, 'handbone'],
  [/\b(?:femur|femoral)\b/, 'femur'],
  [/\bpatella\w*\b/, 'kneebone'],
  [/\b(?:tibia|fibula)\b/, 'tibia'],
  [/\b(?:tarsal|metatars\w*)\b/, 'footbone'],
  [/\b(?:face|facial)\b/, 'face'],
  [/\b(?:head|scalp)\b/, 'head'],
  [/\bshoulder\w*\b/, 'shoulder'],
  [/\b(?:upper arm|arm|arms|upper limb\w*)\b/, 'arm'],
  [/\b(?:elbow|forearm\w*|wrist)\b/, 'forearm'],
  [/\b(?:hand|hands|finger\w*|thumb\w*|palm)\b/, 'hand'],
  [/\b(?:thorax|thoracic|chest)\b/, 'chest'],
  [/\b(?:abdomen|abdominal|belly|umbilic\w*|hernia)\b/, 'abdomen'],
  [/\b(?:pelvis|pelvic|hip|hips|groin|perine\w*|inguinal)\b/, 'pelvis'],
  [/\b(?:thigh|thighs)\b/, 'thigh'],
  [/\b(?:knee|knees)\b/, 'knee'],
  [/\b(?:lower leg|leg|legs|calf|shin|ankle\w*|lower limb\w*)\b/, 'leg'],
  [/\b(?:foot|feet|toe|toes|heel|plantar)\b/, 'foot'],
  [/\b(?:buttock\w*|gluteal)\b/, 'buttock'],
  [/\b(?:back|lumbar|lumbosacral)\b/, 'lumbar'],
  [/\b(?:nerve|nerves|neur\w*|nervous|paralys\w*|palsy|epilep\w*|seizure\w*|parkinson\w*|dementia|alzheimer\w*|migraine|headache|stroke)\b/, 'nervous'],
  [/\b(?:bone|bones|fracture\w*|osteo\w*|skeletal|joint|arthr\w*|cartilage|rheumat\w*|gout)\b/, 'skeleton'],
  [/\b(?:skin|cutaneous|derm\w*|eczema|psoria\w*|nail|nails|hair|rash|urticaria|acne|wound|burn|burns)\b/, 'skin'],
  [/\b(?:endocrine|hormon\w*|adrenal|gonad\w*)\b/, 'endocrine'],
];

const GENERIC = new Set(['nervous', 'skeleton', 'skin', 'endocrine']);

// Body-system chapters: used when no word of the entry points at a specific region.
const CHAPTER_REGION: Record<string, string> = {
  '03': 'circulatory', '05': 'endocrine', '06': 'brain', '07': 'brain', '08': 'nervous', '09': 'eye', '10': 'ear',
  '11': 'circulatory', '12': 'lung', '13': 'digestive', '14': 'skin', '15': 'skeleton', '16': 'urinary', '17': 'pelvis', '18': 'uterus',
};

export interface AnatomyMatch {
  region: string;
  view: View;
  label: string;
  why: string;
}

export function anatomyFor(d: Detail): AnatomyMatch | null {
  if (d.kind === 'chapter' && !CHAPTER_REGION[d.code]) return null;
  const texts: [string, string][] = [['the title', d.title]];
  if (d.fullySpecifiedName) texts.push(['the full name', d.fullySpecifiedName]);
  for (const t of d.indexTerms.slice(0, 30)) texts.push([`the index term “${t}”`, t]);
  // Specific organs and body parts in any text beat the generic system words (nerve, bone, skin...).
  for (const generic of [false, true]) {
    for (const [where, text] of texts) {
      const low = text.toLowerCase();
      for (const [re, region] of RULES) {
        if (GENERIC.has(region) !== generic) continue;
        const m = re.exec(low);
        if (m) return { region, view: REGIONS[region].view, label: REGIONS[region].label, why: `matched “${m[0]}” in ${where}` };
      }
    }
  }
  const chapter = d.kind === 'chapter' ? d.code : d.path[0]?.kind === 'chapter' ? d.path[0].code : '';
  const region = CHAPTER_REGION[chapter];
  if (region) return { region, view: REGIONS[region].view, label: REGIONS[region].label, why: `body-system chapter ${chapter}` };
  return null;
}

export const ANATOMY_CREDITS = [
  {
    title: 'Icdex schematic body diagrams (front, back, internal organs, skeleton)',
    author: 'Icdex project, original artwork generated by tools/anatomy/gen-body.mjs',
    license: 'CC0 1.0 Universal (public domain dedication)',
    page: 'https://creativecommons.org/publicdomain/zero/1.0/',
    note: 'Schematic and not to scale; highlighted regions are parts of this drawing.',
  },
];

// Bundle the artwork with the app so a code can open offline on its first visit.
let bodyTemplate: Element | undefined;

export function anatomyFigure(m: AnatomyMatch): HTMLElement {
  bodyTemplate ??= new DOMParser().parseFromString(bodySvg, 'image/svg+xml').documentElement;
  const svg = document.importNode(bodyTemplate, true);
  svg.setAttribute('aria-label', `Diagram of the human body with the ${m.label.toLowerCase()} highlighted`);
  svg.querySelectorAll('g.view').forEach((g) => g.classList.toggle('shown', g.getAttribute('data-view') === m.view));
  svg.querySelectorAll(`[data-t~="${m.region}"]`).forEach((n) => n.classList.add('on'));
  return h(
    'figure',
    { class: 'anat', 'data-region': m.region, 'data-view': m.view },
    h('div', { class: 'anat-svg' }, svg),
    h(
      'figcaption',
      null,
      'Highlighted: ',
      h('span', { class: 'region-name' }, m.label),
      ` (${m.why}). Schematic, not to scale. `,
      h('span', { class: 'credit' }, 'Artwork: Icdex, ', h('a', { href: ANATOMY_CREDITS[0].page, target: '_blank', rel: 'noopener' }, 'CC0 1.0'), '.'),
    ),
  );
}
