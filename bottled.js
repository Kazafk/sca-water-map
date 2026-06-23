import { scoreFromParams, colorFromScore, labelFromScore } from './scoring.js';

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Raw data (44 curated waters) ──────────────────────────────────────────────
const RAW = [
  { id:'evian', nom:'Evian', pays:'France', ville_origine:'Évian-les-Bains (Source Cachat)', entreprise:'Danone', type_eau:'Plate', categorie:'Minérale', ph:7.2, tds_mg_l:345, calcium_mg_l:80.0, magnesium_mg_l:26.0, sodium_mg_l:6.5, potassium_mg_l:1.0, bicarbonate_mg_l:360.0, sulfate_mg_l:15.0, chlorure_mg_l:10.0, silice_mg_l:15.0, nitrate_mg_l:3.8, description:"Eau faiblement minéralisée, filtrée pendant 15 ans au cœur des Alpes. Très pauvre en sodium, convient aux nourrissons." },
  { id:'volvic', nom:'Volvic', pays:'France', ville_origine:'Volvic (Source Clairvic)', entreprise:'Danone', type_eau:'Plate', categorie:'Minérale', ph:7.0, tds_mg_l:130, calcium_mg_l:12.0, magnesium_mg_l:8.0, sodium_mg_l:12.0, potassium_mg_l:6.0, bicarbonate_mg_l:74.0, sulfate_mg_l:9.0, chlorure_mg_l:15.0, silice_mg_l:32.0, nitrate_mg_l:7.3, description:"Issue du Parc Naturel des Volcans d'Auvergne, filtrée par des roches volcaniques. Faiblement minéralisée, pH neutre." },
  { id:'vittel', nom:'Vittel', pays:'France', ville_origine:'Vittel (Source Bonne Source)', entreprise:'Nestlé Waters', type_eau:'Plate', categorie:'Minérale', ph:7.6, tds_mg_l:1084, calcium_mg_l:202.0, magnesium_mg_l:42.0, sodium_mg_l:4.7, potassium_mg_l:2.0, bicarbonate_mg_l:384.0, sulfate_mg_l:306.0, chlorure_mg_l:8.0, silice_mg_l:null, nitrate_mg_l:4.4, description:"Source située dans les Vosges. Moyennement minéralisée, riche en calcium." },
  { id:'contrex', nom:'Contrex', pays:'France', ville_origine:'Contrexéville', entreprise:'Nestlé Waters', type_eau:'Plate', categorie:'Minérale', ph:7.4, tds_mg_l:2078, calcium_mg_l:468.0, magnesium_mg_l:74.5, sodium_mg_l:9.4, potassium_mg_l:2.8, bicarbonate_mg_l:372.0, sulfate_mg_l:1121.0, chlorure_mg_l:7.6, silice_mg_l:13.5, nitrate_mg_l:2.7, description:"Très fortement minéralisée, particulièrement riche en calcium et sulfates. Idéale pour combler les carences en calcium." },
  { id:'hepar', nom:'Hépar', pays:'France', ville_origine:'Vittel', entreprise:'Nestlé Waters', type_eau:'Plate', categorie:'Minérale', ph:7.2, tds_mg_l:2513, calcium_mg_l:549.0, magnesium_mg_l:119.0, sodium_mg_l:14.0, potassium_mg_l:4.0, bicarbonate_mg_l:384.0, sulfate_mg_l:1530.0, chlorure_mg_l:11.0, silice_mg_l:null, nitrate_mg_l:4.3, description:"Teneur exceptionnellement élevée en magnésium et calcium. Recommandée pour le transit intestinal." },
  { id:'badoit', nom:'Badoit', pays:'France', ville_origine:'Saint-Galmier', entreprise:'Danone', type_eau:'Gazeuse', categorie:'Minérale', ph:6.0, tds_mg_l:1100, calcium_mg_l:153.0, magnesium_mg_l:80.0, sodium_mg_l:180.0, potassium_mg_l:10.0, bicarbonate_mg_l:1250.0, sulfate_mg_l:35.0, chlorure_mg_l:40.0, silice_mg_l:27.0, nitrate_mg_l:6.0, description:"Eau naturellement gazeuse riche en bicarbonates et sodium. Aide à la digestion, très prisée en gastronomie." },
  { id:'perrier', nom:'Perrier', pays:'France', ville_origine:'Vergèze (Source de la Bouillens)', entreprise:'Nestlé Waters', type_eau:'Gazeuse', categorie:'Minérale', ph:5.5, tds_mg_l:480, calcium_mg_l:155.0, magnesium_mg_l:4.0, sodium_mg_l:9.5, potassium_mg_l:1.0, bicarbonate_mg_l:430.0, sulfate_mg_l:33.0, chlorure_mg_l:22.0, silice_mg_l:null, nitrate_mg_l:5.0, description:"Célèbre eau minérale gazeuse, pétillante avec de fortes bulles. Acide dû au CO₂." },
  { id:'san_pellegrino', nom:'San Pellegrino', pays:'Italie', ville_origine:'San Pellegrino Terme (Lombardie)', entreprise:'Nestlé Waters', type_eau:'Gazeuse', categorie:'Minérale', ph:7.6, tds_mg_l:854, calcium_mg_l:164.0, magnesium_mg_l:49.5, sodium_mg_l:31.2, potassium_mg_l:2.2, bicarbonate_mg_l:244.0, sulfate_mg_l:402.0, chlorure_mg_l:49.8, silice_mg_l:7.2, nitrate_mg_l:2.6, description:"Eau de source thermale calcaire des Alpes italiennes, gazéifiée. Goût très structuré." },
  { id:'acqua_panna', nom:'Acqua Panna', pays:'Italie', ville_origine:'Scarperia e San Piero (Toscane)', entreprise:'Nestlé Waters', type_eau:'Plate', categorie:'Minérale', ph:8.2, tds_mg_l:140, calcium_mg_l:32.0, magnesium_mg_l:6.5, sodium_mg_l:6.6, potassium_mg_l:0.8, bicarbonate_mg_l:106.0, sulfate_mg_l:22.0, chlorure_mg_l:7.8, silice_mg_l:7.0, nitrate_mg_l:2.9, description:"Eau très légère et douce, légèrement alcaline. Très appréciée par l'Association Internationale des Sommeliers." },
  { id:'fiji', nom:'Fiji', pays:'Fidji', ville_origine:"Vallée de Yaqara (Île de Viti Levu)", entreprise:'The Wonderful Company', type_eau:'Plate', categorie:'Artésienne', ph:7.7, tds_mg_l:222, calcium_mg_l:18.0, magnesium_mg_l:15.0, sodium_mg_l:18.0, potassium_mg_l:5.0, bicarbonate_mg_l:153.0, sulfate_mg_l:1.0, chlorure_mg_l:9.0, silice_mg_l:93.0, nitrate_mg_l:1.0, description:"Eau artésienne extraite d'une nappe souterraine protégée. Extrêmement riche en silice, ce qui lui confère une texture soyeuse en bouche." },
  // ── Cristaline — 19 sources individuelles (données Wikipedia) ──────────────
  { id:'cristaline_aurele',       nom:'Cristaline – Aurèle',        pays:'France',     ville_origine:'Ardennes',           entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.2, tds_mg_l:268,  calcium_mg_l:106.0, magnesium_mg_l:4.2,  sodium_mg_l:3.5,  potassium_mg_l:1.5, bicarbonate_mg_l:272.0, sulfate_mg_l:50.0,  chlorure_mg_l:3.8,   silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline des Ardennes. Riche en calcium, très faible en nitrates." },
  { id:'cristaline_celine',       nom:'Cristaline – Céline',        pays:'France',     ville_origine:'Loiret',             entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.5, tds_mg_l:274,  calcium_mg_l:68.0,  magnesium_mg_l:7.0,  sodium_mg_l:11.0, potassium_mg_l:4.0,  bicarbonate_mg_l:234.0, sulfate_mg_l:5.0,   chlorure_mg_l:19.0,  silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline du Loiret. Calcium proche de l'idéal SCA, alcalinité élevée." },
  { id:'cristaline_chantereine',  nom:'Cristaline – Chantereine',   pays:'France',     ville_origine:'Seine-et-Marne',     entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.5, tds_mg_l:467,  calcium_mg_l:119.0, magnesium_mg_l:28.0, sodium_mg_l:6.0,  potassium_mg_l:2.0,  bicarbonate_mg_l:430.0, sulfate_mg_l:55.0,  chlorure_mg_l:8.0,   silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline de Seine-et-Marne. Fortement minéralisée, très riche en bicarbonates et calcium." },
  { id:'cristaline_cristal_roc',  nom:'Cristaline – Cristal-Roc',   pays:'France',     ville_origine:'Sarthe',             entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.7, tds_mg_l:223,  calcium_mg_l:73.0,  magnesium_mg_l:2.0,  sodium_mg_l:4.5,  potassium_mg_l:1.3,  bicarbonate_mg_l:200.0, sulfate_mg_l:20.0,  chlorure_mg_l:10.0,  silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline de la Sarthe. Profil calcique modéré, faiblement sodée." },
  { id:'cristaline_elena',        nom:'Cristaline – Elena',         pays:'France',     ville_origine:'Loiret',             entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.6, tds_mg_l:241,  calcium_mg_l:67.5,  magnesium_mg_l:6.9,  sodium_mg_l:8.4,  potassium_mg_l:2.3,  bicarbonate_mg_l:228.0, sulfate_mg_l:11.0,  chlorure_mg_l:15.0,  silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline du Loiret. Calcium proche de l'idéal SCA, alcalinité importante." },
  { id:'cristaline_eleonore',     nom:'Cristaline – Éléonore',      pays:'France',     ville_origine:'Loire-Atlantique',   entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.7, tds_mg_l:347,  calcium_mg_l:67.0,  magnesium_mg_l:14.7, sodium_mg_l:20.8, potassium_mg_l:1.2,  bicarbonate_mg_l:236.0, sulfate_mg_l:38.0,  chlorure_mg_l:38.7,  silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline de Loire-Atlantique. Sodium et chlorures modérément élevés." },
  { id:'cristaline_emma',         nom:'Cristaline – Emma',          pays:'France',     ville_origine:"Eure",               entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.2, tds_mg_l:239,  calcium_mg_l:38.0,  magnesium_mg_l:15.0, sodium_mg_l:11.0, potassium_mg_l:15.0, bicarbonate_mg_l:190.0, sulfate_mg_l:32.0,  chlorure_mg_l:10.4,  silice_mg_l:null, nitrate_mg_l:1.0,  description:"Source Cristaline de l'Eure. Potassium élevé, calcium modéré." },
  { id:'cristaline_isabelle',     nom:'Cristaline – Isabelle',      pays:'France',     ville_origine:'Finistère',          entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:5.4, tds_mg_l:50,   calcium_mg_l:1.5,   magnesium_mg_l:2.2,  sodium_mg_l:12.5, potassium_mg_l:0.5,  bicarbonate_mg_l:3.5,   sulfate_mg_l:3.0,   chlorure_mg_l:20.0,  silice_mg_l:null, nitrate_mg_l:5.0,  description:"Source Cristaline du Finistère. Très faiblement minéralisée et acide (pH 5.4), quasi distillée." },
  { id:'cristaline_la_doye',      nom:'Cristaline – La Doye',       pays:'France',     ville_origine:"Ain",                entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.5, tds_mg_l:223,  calcium_mg_l:64.5,  magnesium_mg_l:3.5,  sodium_mg_l:12.0, potassium_mg_l:0.5,  bicarbonate_mg_l:195.0, sulfate_mg_l:6.0,   chlorure_mg_l:20.0,  silice_mg_l:null, nitrate_mg_l:2.5,  description:"Source Cristaline de l'Ain. Calcium proche de l'idéal SCA, alcalinité élevée." },
  { id:'cristaline_louise',       nom:'Cristaline – Louise',        pays:'France',     ville_origine:'Nord',               entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.5, tds_mg_l:455,  calcium_mg_l:65.0,  magnesium_mg_l:26.0, sodium_mg_l:55.0, potassium_mg_l:20.0, bicarbonate_mg_l:443.0, sulfate_mg_l:29.0,  chlorure_mg_l:13.0,  silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline du Nord. Sodium élevé, bicarbonates très importants." },
  { id:'cristaline_lydivine',     nom:'Cristaline – Lydivine',      pays:'France',     ville_origine:'Marne',              entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.6, tds_mg_l:480,  calcium_mg_l:120.0, magnesium_mg_l:25.0, sodium_mg_l:7.0,  potassium_mg_l:3.0,  bicarbonate_mg_l:430.0, sulfate_mg_l:37.0,  chlorure_mg_l:8.0,   silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline de la Marne. Très calcique et très bicarbonatée, idéale pour la digestion." },
  { id:'cristaline_noemie',       nom:'Cristaline – Noémie',        pays:'France',     ville_origine:'Seine-et-Marne',     entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.3, tds_mg_l:421,  calcium_mg_l:113.0, magnesium_mg_l:28.0, sodium_mg_l:7.0,  potassium_mg_l:2.0,  bicarbonate_mg_l:447.0, sulfate_mg_l:42.0,  chlorure_mg_l:8.0,   silice_mg_l:null, nitrate_mg_l:1.0,  description:"Source Cristaline de Seine-et-Marne. Très riche en calcium, magnésium et bicarbonates." },
  { id:'cristaline_perline',      nom:'Cristaline – Perline',       pays:'France',     ville_origine:'Ardèche',            entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:4.9, tds_mg_l:162,  calcium_mg_l:6.0,   magnesium_mg_l:3.0,  sodium_mg_l:31.0, potassium_mg_l:1.1,  bicarbonate_mg_l:72.0,  sulfate_mg_l:7.0,   chlorure_mg_l:8.0,   silice_mg_l:null, nitrate_mg_l:1.0,  description:"Source Cristaline d'Ardèche. Très acide (pH 4.9), élevée en sodium, atypique pour une eau de source." },
  { id:'cristaline_rey',          nom:'Cristaline – Rey',           pays:'Italie',     ville_origine:'Italie',             entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.7, tds_mg_l:196,  calcium_mg_l:54.0,  magnesium_mg_l:6.0,  sodium_mg_l:1.4,  potassium_mg_l:2.1,  bicarbonate_mg_l:129.0, sulfate_mg_l:64.0,  chlorure_mg_l:0.2,   silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline en Italie. La seule source italienne du réseau, très faible en sodium et chlorures." },
  { id:'cristaline_roxane',       nom:'Cristaline – Roxane',        pays:'Luxembourg', ville_origine:'Luxembourg',         entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.6, tds_mg_l:275,  calcium_mg_l:98.0,  magnesium_mg_l:2.0,  sodium_mg_l:3.1,  potassium_mg_l:0.6,  bicarbonate_mg_l:257.0, sulfate_mg_l:33.0,  chlorure_mg_l:6.8,   silice_mg_l:null, nitrate_mg_l:6.9,  description:"Source Cristaline au Luxembourg. Calcique, faiblement sodée, nitrates un peu élevés." },
  { id:'cristaline_sainte_cecile',nom:'Cristaline – Sainte-Cécile', pays:'France',     ville_origine:'Vaucluse',           entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.7, tds_mg_l:270,  calcium_mg_l:39.0,  magnesium_mg_l:25.0, sodium_mg_l:19.0, potassium_mg_l:1.5,  bicarbonate_mg_l:290.0, sulfate_mg_l:5.0,   chlorure_mg_l:5.0,   silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline du Vaucluse. Composition figurant sur de nombreuses bouteilles Cristaline, bonne teneur en magnésium." },
  { id:'cristaline_sainte_sophie',nom:'Cristaline – Sainte-Sophie', pays:'France',     ville_origine:'Nord',               entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.4, tds_mg_l:564,  calcium_mg_l:67.0,  magnesium_mg_l:26.0, sodium_mg_l:84.0, potassium_mg_l:20.0, bicarbonate_mg_l:473.0, sulfate_mg_l:61.0,  chlorure_mg_l:32.0,  silice_mg_l:null, nitrate_mg_l:1.0,  description:"Source Cristaline du Nord. Sodium et TDS très élevés, bicarbonates record parmi les sources Cristaline." },
  { id:'cristaline_valon',        nom:'Cristaline – Valon',         pays:'France',     ville_origine:'Haut-Rhin',          entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:6.5, tds_mg_l:25,   calcium_mg_l:6.4,   magnesium_mg_l:1.2,  sodium_mg_l:3.0,  potassium_mg_l:0.5,  bicarbonate_mg_l:20.0,  sulfate_mg_l:5.0,   chlorure_mg_l:3.0,   silice_mg_l:null, nitrate_mg_l:4.0,  description:"Source Cristaline du Haut-Rhin. La plus douce du réseau Cristaline, quasiment distillée." },
  { id:'cristaline_vermont',      nom:'Cristaline – Vermont',       pays:'France',     ville_origine:'Rhône',              entreprise:'Sources Alma (Cristaline)', type_eau:'Plate', categorie:'Source', ph:7.3, tds_mg_l:300,  calcium_mg_l:64.0,  magnesium_mg_l:10.0, sodium_mg_l:89.0, potassium_mg_l:3.0,  bicarbonate_mg_l:245.0, sulfate_mg_l:17.0,  chlorure_mg_l:140.0, silice_mg_l:null, nitrate_mg_l:0.5,  description:"Source Cristaline du Rhône. Très élevée en sodium et chlorures, composition atypique." },
  { id:'rozana', nom:'Rozana', pays:'France', ville_origine:'Rouzat (Puy-de-Dôme)', entreprise:'Sources Alma', type_eau:'Gazeuse', categorie:'Minérale', ph:6.3, tds_mg_l:3000, calcium_mg_l:301.0, magnesium_mg_l:160.0, sodium_mg_l:493.0, potassium_mg_l:52.0, bicarbonate_mg_l:1837.0, sulfate_mg_l:230.0, chlorure_mg_l:649.0, silice_mg_l:null, nitrate_mg_l:1.0, description:"Naturellement gazeuse et extrêmement riche en magnésium (160 mg/L)." },
  { id:'vichy_celestins', nom:'Vichy Célestins', pays:'France', ville_origine:'Vichy', entreprise:'GIE Sources de Vichy', type_eau:'Gazeuse', categorie:'Minérale', ph:6.8, tds_mg_l:3378, calcium_mg_l:103.0, magnesium_mg_l:10.0, sodium_mg_l:1172.0, potassium_mg_l:66.0, bicarbonate_mg_l:2989.0, sulfate_mg_l:138.0, chlorure_mg_l:235.0, silice_mg_l:42.5, nitrate_mg_l:1.0, description:"Eau thermale alcaline très riche en bicarbonates et en sodium. Aide à la digestion et réputée pour le teint." },
  { id:'saint_yorre', nom:'Saint-Yorre', pays:'France', ville_origine:'Saint-Yorre', entreprise:'GIE Sources de Vichy', type_eau:'Gazeuse', categorie:'Minérale', ph:6.6, tds_mg_l:4774, calcium_mg_l:90.0, magnesium_mg_l:11.0, sodium_mg_l:1708.0, potassium_mg_l:110.0, bicarbonate_mg_l:4368.0, sulfate_mg_l:174.0, chlorure_mg_l:322.0, silice_mg_l:null, nitrate_mg_l:1.0, description:"Une des eaux les plus minéralisées de France. Teneur record en bicarbonates et sodium. Idéale pour la récupération sportive." },
  { id:'gerolsteiner', nom:'Gerolsteiner', pays:'Allemagne', ville_origine:'Gerolstein (Eifel volcanique)', entreprise:'Gerolsteiner Brunnen', type_eau:'Gazeuse', categorie:'Minérale', ph:5.9, tds_mg_l:2488, calcium_mg_l:348.0, magnesium_mg_l:108.0, sodium_mg_l:118.0, potassium_mg_l:11.0, bicarbonate_mg_l:1816.0, sulfate_mg_l:38.0, chlorure_mg_l:40.0, silice_mg_l:40.2, nitrate_mg_l:3.5, description:"Eau minérale volcanique gazeuse la plus vendue d'Allemagne. Profil calcium-magnésium équilibré." },
  { id:'borjomi', nom:'Borjomi', pays:'Géorgie', ville_origine:'Gorge de Borjomi (Caucase)', entreprise:'IDS Borjomi Georgia', type_eau:'Gazeuse', categorie:'Minérale', ph:6.8, tds_mg_l:6200, calcium_mg_l:80.0, magnesium_mg_l:50.0, sodium_mg_l:1500.0, potassium_mg_l:30.0, bicarbonate_mg_l:4200.0, sulfate_mg_l:20.0, chlorure_mg_l:380.0, silice_mg_l:null, nitrate_mg_l:0.5, description:"Eau volcanique géorgienne réputée pour sa très forte salinité, ses bicarbonates élevés et son goût de terroir affirmé." },
  { id:'courmayeur', nom:'Courmayeur', pays:'Italie', ville_origine:"Courmayeur (Val d'Aoste)", entreprise:'Sources Alma', type_eau:'Plate', categorie:'Minérale', ph:7.7, tds_mg_l:2146, calcium_mg_l:565.0, magnesium_mg_l:60.0, sodium_mg_l:0.6, potassium_mg_l:2.0, bicarbonate_mg_l:185.0, sulfate_mg_l:1411.0, chlorure_mg_l:0.5, silice_mg_l:4.6, nitrate_mg_l:1.5, description:"Eau très riche en calcium et sulfates, mais quasiment sans sodium. Conseillée pour les régimes de contrôle du poids." },
  { id:'spa_reine', nom:'Spa Reine', pays:'Belgique', ville_origine:'Spa (Ardennes)', entreprise:'Spadel', type_eau:'Plate', categorie:'Minérale', ph:6.0, tds_mg_l:33, calcium_mg_l:4.5, magnesium_mg_l:1.3, sodium_mg_l:3.0, potassium_mg_l:0.5, bicarbonate_mg_l:13.0, sulfate_mg_l:6.0, chlorure_mg_l:5.0, silice_mg_l:7.0, nitrate_mg_l:1.5, description:"Eau extrêmement pure et faiblement minéralisée issue des Ardennes belges. Un des TDS les plus bas d'Europe." },
  { id:'wattwiller', nom:'Wattwiller', pays:'France', ville_origine:'Wattwiller (Vosges)', entreprise:'Spadel', type_eau:'Plate', categorie:'Minérale', ph:7.5, tds_mg_l:155, calcium_mg_l:35.0, magnesium_mg_l:11.0, sodium_mg_l:3.0, potassium_mg_l:1.0, bicarbonate_mg_l:135.0, sulfate_mg_l:24.0, chlorure_mg_l:0.0, silice_mg_l:null, nitrate_mg_l:0.0, description:"Zéro nitrate, extrêmement pure. Très faible en sodium, idéale pour la consommation quotidienne et les nourrissons." },
  { id:'mont_roucous', nom:'Mont Roucous', pays:'France', ville_origine:'Lacaune (Tarn)', entreprise:'Sources Alma', type_eau:'Plate', categorie:'Minérale', ph:5.8, tds_mg_l:33, calcium_mg_l:2.7, magnesium_mg_l:0.5, sodium_mg_l:3.0, potassium_mg_l:0.4, bicarbonate_mg_l:6.0, sulfate_mg_l:2.5, chlorure_mg_l:6.7, silice_mg_l:3.1, nitrate_mg_l:2.0, description:"Très faiblement minéralisée, convient parfaitement aux nourrissons et pour les régimes pauvres en sel." },
  { id:'chateldon', nom:'Chateldon', pays:'France', ville_origine:'Châteldon (Puy-de-Dôme)', entreprise:'Groupe Neptune / Alma', type_eau:'Gazeuse', categorie:'Minérale', ph:6.2, tds_mg_l:1882, calcium_mg_l:370.0, magnesium_mg_l:49.0, sodium_mg_l:240.0, potassium_mg_l:35.0, bicarbonate_mg_l:2075.0, sulfate_mg_l:21.0, chlorure_mg_l:6.0, silice_mg_l:21.0, nitrate_mg_l:2.0, description:"L'eau historique de Louis XIV. Fine pétillance naturelle, riche en calcium et bicarbonates. Produite en quantité limitée." },
  { id:'highland_spring', nom:'Highland Spring', pays:'Royaume-Uni', ville_origine:'Ochil Hills (Écosse)', entreprise:'Highland Spring Group', type_eau:'Plate', categorie:'Source', ph:7.8, tds_mg_l:170, calcium_mg_l:40.5, magnesium_mg_l:10.1, sodium_mg_l:5.6, potassium_mg_l:0.8, bicarbonate_mg_l:150.0, sulfate_mg_l:6.0, chlorure_mg_l:6.0, silice_mg_l:null, nitrate_mg_l:3.0, description:"Eau de source écossaise naturelle filtrée par le sol sablonneux des collines d'Ochil." },
  { id:'buxton', nom:'Buxton', pays:'Royaume-Uni', ville_origine:'Buxton (Derbyshire)', entreprise:'Nestlé Waters', type_eau:'Plate', categorie:'Minérale', ph:7.4, tds_mg_l:280, calcium_mg_l:55.0, magnesium_mg_l:19.0, sodium_mg_l:24.0, potassium_mg_l:1.0, bicarbonate_mg_l:200.0, sulfate_mg_l:13.0, chlorure_mg_l:37.0, silice_mg_l:null, nitrate_mg_l:0.2, description:"Filtrée sur calcaire dans le Derbyshire. Teneur équilibrée en calcium." },
  { id:'san_benedetto', nom:'San Benedetto', pays:'Italie', ville_origine:'Scorzè (Vénétie)', entreprise:'Acqua Minerale San Benedetto', type_eau:'Plate', categorie:'Minérale', ph:7.8, tds_mg_l:250, calcium_mg_l:47.0, magnesium_mg_l:28.0, sodium_mg_l:8.0, potassium_mg_l:1.0, bicarbonate_mg_l:295.0, sulfate_mg_l:25.0, chlorure_mg_l:8.0, silice_mg_l:15.0, nitrate_mg_l:4.0, description:"L'une des eaux les plus vendues en Italie, issue d'un bassin souterrain profond. Bon équilibre global." },
  { id:'solan_de_cabras', nom:'Solán de Cabras', pays:'Espagne', ville_origine:'Beteta (Cuenca)', entreprise:'Mahou San Miguel', type_eau:'Plate', categorie:'Minérale', ph:7.4, tds_mg_l:278, calcium_mg_l:59.4, magnesium_mg_l:25.8, sodium_mg_l:5.1, potassium_mg_l:1.1, bicarbonate_mg_l:284.0, sulfate_mg_l:21.8, chlorure_mg_l:7.4, silice_mg_l:8.0, nitrate_mg_l:2.1, description:"Eau d'une source thermale célèbre d'Espagne. Très populaire dans sa bouteille bleue iconique." },
  { id:'voss', nom:'Voss', pays:'Norvège', ville_origine:'Iveland', entreprise:'Voss of Norway AS', type_eau:'Plate', categorie:'Artésienne', ph:6.0, tds_mg_l:35, calcium_mg_l:4.0, magnesium_mg_l:0.8, sodium_mg_l:4.0, potassium_mg_l:0.2, bicarbonate_mg_l:12.0, sulfate_mg_l:2.0, chlorure_mg_l:5.0, silice_mg_l:0.1, nitrate_mg_l:0.1, description:"Eau artésienne norvégienne de prestige, réputée pour sa très faible minéralisation." },
  { id:'dasani', nom:'Dasani', pays:'États-Unis', ville_origine:'Multi-sources (Purifiée)', entreprise:'The Coca-Cola Company', type_eau:'Plate', categorie:'Purifiée', ph:5.3, tds_mg_l:50, calcium_mg_l:0.0, magnesium_mg_l:5.0, sodium_mg_l:10.0, potassium_mg_l:5.0, bicarbonate_mg_l:0.0, sulfate_mg_l:15.0, chlorure_mg_l:8.0, silice_mg_l:null, nitrate_mg_l:0.0, description:"Eau locale purifiée par osmose inverse avec minéraux rajoutés pour le goût." },
  { id:'smartwater', nom:'Smartwater', pays:'États-Unis', ville_origine:'Multi-sources (Purifiée)', entreprise:'The Coca-Cola Company', type_eau:'Plate', categorie:'Purifiée', ph:7.6, tds_mg_l:40, calcium_mg_l:2.0, magnesium_mg_l:2.0, sodium_mg_l:0.0, potassium_mg_l:2.0, bicarbonate_mg_l:10.0, sulfate_mg_l:0.0, chlorure_mg_l:8.0, silice_mg_l:null, nitrate_mg_l:0.0, description:"Eau distillée à la vapeur, enrichie en électrolytes pour un goût pur." },
  { id:'vichy_catalan', nom:'Vichy Catalan', pays:'Espagne', ville_origine:'Caldes de Malavella (Gérone)', entreprise:'Grupo Vichy Catalan', type_eau:'Gazeuse', categorie:'Minérale', ph:7.5, tds_mg_l:2976, calcium_mg_l:14.5, magnesium_mg_l:7.5, sodium_mg_l:1090.0, potassium_mg_l:50.0, bicarbonate_mg_l:2081.0, sulfate_mg_l:46.0, chlorure_mg_l:584.0, silice_mg_l:75.0, nitrate_mg_l:1.0, description:"Eau naturellement gazeuse espagnole très salée et riche en bicarbonate. Goût inimitable." },
  { id:'pedras_salgadas', nom:'Pedras Salgadas', pays:'Portugal', ville_origine:'Vila Real', entreprise:'Super Bock Group', type_eau:'Gazeuse', categorie:'Minérale', ph:6.1, tds_mg_l:2807, calcium_mg_l:102.0, magnesium_mg_l:24.0, sodium_mg_l:577.0, potassium_mg_l:25.0, bicarbonate_mg_l:1983.0, sulfate_mg_l:8.0, chlorure_mg_l:28.0, silice_mg_l:62.0, nitrate_mg_l:1.0, description:"Eau thermale portugaise naturellement pétillante. Excellente pour le système digestif." },
  { id:'radenska', nom:'Radenska Kraljevi Vrelec', pays:'Slovénie', ville_origine:'Radenci', entreprise:'Kofola', type_eau:'Gazeuse', categorie:'Minérale', ph:6.4, tds_mg_l:3172, calcium_mg_l:210.0, magnesium_mg_l:90.0, sodium_mg_l:435.0, potassium_mg_l:70.0, bicarbonate_mg_l:2100.0, sulfate_mg_l:85.0, chlorure_mg_l:60.0, silice_mg_l:null, nitrate_mg_l:2.0, description:"Eau minérale naturellement gazeuse slovène aux 3 cœurs, très riche en minéraux." },
  { id:'ferrarelle', nom:'Ferrarelle', pays:'Italie', ville_origine:'Riardo (Campanie)', entreprise:'Lete S.p.A.', type_eau:'Gazeuse', categorie:'Minérale', ph:6.3, tds_mg_l:1285, calcium_mg_l:362.0, magnesium_mg_l:18.0, sodium_mg_l:49.0, potassium_mg_l:47.0, bicarbonate_mg_l:1480.0, sulfate_mg_l:4.0, chlorure_mg_l:49.0, silice_mg_l:80.0, nitrate_mg_l:5.0, description:"Eau minérale naturellement gazeuse de Campanie, célèbre pour sa bulle très fine et son équilibre calcium-bicarbonate." },
  { id:'luso', nom:'Luso', pays:'Portugal', ville_origine:'Luso (Serra do Bussaco)', entreprise:'Sociedade da Água de Luso (Super Bock Group)', type_eau:'Plate', categorie:'Minérale', ph:5.7, tds_mg_l:43, calcium_mg_l:1.8, magnesium_mg_l:1.5, sodium_mg_l:6.4, potassium_mg_l:1.5, bicarbonate_mg_l:9.0, sulfate_mg_l:1.6, chlorure_mg_l:8.5, silice_mg_l:15.0, nitrate_mg_l:1.4, description:"Eau minérale plate très faiblement minéralisée provenant d'une source montagneuse protégée, très populaire au Portugal." },
  { id:'icelandic_glacial', nom:'Icelandic Glacial', pays:'Islande', ville_origine:'Source Ölfus', entreprise:'Icelandic Water Holdings', type_eau:'Plate', categorie:'Source', ph:8.4, tds_mg_l:62, calcium_mg_l:6.4, magnesium_mg_l:2.4, sodium_mg_l:11.0, potassium_mg_l:0.6, bicarbonate_mg_l:32.0, sulfate_mg_l:2.0, chlorure_mg_l:12.0, silice_mg_l:11.0, nitrate_mg_l:0.1, description:"Eau de source glaciaire d'une pureté exceptionnelle et d'un pH naturellement alcalin (8.4). Première eau en bouteille certifiée neutre en carbone." },
  { id:'velleminfroy', nom:'Velleminfroy', pays:'France', ville_origine:'Velleminfroy (Haute-Saône)', entreprise:'Compagnie de Velleminfroy', type_eau:'Plate', categorie:'Minérale', ph:7.4, tds_mg_l:2010, calcium_mg_l:480.0, magnesium_mg_l:67.0, sodium_mg_l:10.4, potassium_mg_l:3.0, bicarbonate_mg_l:400.0, sulfate_mg_l:1190.0, chlorure_mg_l:8.0, silice_mg_l:null, nitrate_mg_l:0.0, description:"Eau plate de Haute-Saône redécouverte récemment, extrêmement minéralisée. Très riche en calcium et sulfates, sans sodium." },
  { id:'abatilles', nom:'Abatilles', pays:'France', ville_origine:'Arcachon (Gironde)', entreprise:"Société des Eaux Minérales d'Arcachon", type_eau:'Plate', categorie:'Minérale', ph:8.2, tds_mg_l:354, calcium_mg_l:19.0, magnesium_mg_l:8.0, sodium_mg_l:95.0, potassium_mg_l:3.0, bicarbonate_mg_l:122.0, sulfate_mg_l:8.0, chlorure_mg_l:137.0, silice_mg_l:28.0, nitrate_mg_l:0.0, description:"Eau minérale plate puisée à 472m de profondeur dans le bassin d'Arcachon. Légère, pure et sans nitrates." },
  { id:'lanjaron', nom:'Lanjarón', pays:'Espagne', ville_origine:'Lanjarón (Sierra Nevada, Grenade)', entreprise:'Danone', type_eau:'Plate', categorie:'Minérale', ph:7.2, tds_mg_l:140, calcium_mg_l:29.0, magnesium_mg_l:10.0, sodium_mg_l:6.0, potassium_mg_l:1.0, bicarbonate_mg_l:115.0, sulfate_mg_l:17.0, chlorure_mg_l:6.0, silice_mg_l:null, nitrate_mg_l:2.2, description:"Eau issue des sommets enneigés et des parcs naturels de la Sierra Nevada. Faible minéralisation, recommandée pour la consommation quotidienne." },
  { id:'hildon', nom:'Hildon', pays:'Royaume-Uni', ville_origine:'Broughton (Hampshire)', entreprise:'Hildon Ltd.', type_eau:'Plate', categorie:'Minérale', ph:7.6, tds_mg_l:312, calcium_mg_l:97.0, magnesium_mg_l:1.7, sodium_mg_l:7.7, potassium_mg_l:1.0, bicarbonate_mg_l:312.0, sulfate_mg_l:4.0, chlorure_mg_l:16.0, silice_mg_l:null, nitrate_mg_l:1.5, description:"Eau de source anglaise du Hampshire de grande pureté. Filtrée par la craie naturelle, goût neutre classique." },
  { id:'liquid_death', nom:'Liquid Death', pays:'Autriche / États-Unis', ville_origine:'Frankenmarkt (Alpes autrichiennes)', entreprise:'Liquid Death Mountain Water', type_eau:'Plate', categorie:'Source', ph:7.6, tds_mg_l:170, calcium_mg_l:38.0, magnesium_mg_l:12.0, sodium_mg_l:5.0, potassium_mg_l:1.0, bicarbonate_mg_l:160.0, sulfate_mg_l:6.0, chlorure_mg_l:6.0, silice_mg_l:null, nitrate_mg_l:1.2, description:"Eau de source naturelle des Alpes autrichiennes vendue en canettes recyclables. Phénomène marketing disruptif américain." },
  { id:'quezac', nom:'Quézac', pays:'France', ville_origine:'Quézac (Lozère)', entreprise:'Ogeu Groupe', type_eau:'Gazeuse', categorie:'Minérale', ph:6.2, tds_mg_l:1000, calcium_mg_l:165.0, magnesium_mg_l:69.0, sodium_mg_l:110.0, potassium_mg_l:2.0, bicarbonate_mg_l:1000.0, sulfate_mg_l:30.0, chlorure_mg_l:35.0, silice_mg_l:null, nitrate_mg_l:0.0, description:"Célèbre eau gazeuse de Lozère, connue pour sa teneur en bicarbonates et en calcium. Parfaite pour la digestion, pauvre en nitrates." },
  { id:'veen_velvet', nom:'VEEN Velvet', pays:'Finlande', ville_origine:'Source Konisaajo (Laponie)', entreprise:'VEEN Waters', type_eau:'Plate', categorie:'Source', ph:6.6, tds_mg_l:17.2, calcium_mg_l:2.4, magnesium_mg_l:0.67, sodium_mg_l:1.9, potassium_mg_l:0.7, bicarbonate_mg_l:9.0, sulfate_mg_l:3.9, chlorure_mg_l:0.7, silice_mg_l:11.0, nitrate_mg_l:0.15, description:"Eau de source extrêmement pure et douce issue de l'Arctique finlandais, très prisée des sommeliers pour accompagner les grands repas." },
  { id:'jeju_samdasoo', nom:'Jeju Samdasoo', pays:'Corée du Sud', ville_origine:'Île de Jeju', entreprise:'Jeju Province Development Co.', type_eau:'Plate', categorie:'Minérale', ph:7.8, tds_mg_l:40.0, calcium_mg_l:3.2, magnesium_mg_l:2.6, sodium_mg_l:5.6, potassium_mg_l:2.5, bicarbonate_mg_l:15.0, sulfate_mg_l:1.0, chlorure_mg_l:2.0, silice_mg_l:19.0, nitrate_mg_l:0.5, description:"Eau minérale volcanique filtrée à travers des centaines de couches de basalte sur l'île de Jeju, procurant une texture légère et pure." },
  { id:'suntory_tennensui', nom:'Suntory Tennensui', pays:'Japon', ville_origine:'Alpes du Sud (Yamanashi)', entreprise:'Suntory', type_eau:'Plate', categorie:'Source', ph:7.0, tds_mg_l:30.0, calcium_mg_l:5.0, magnesium_mg_l:2.0, sodium_mg_l:7.0, potassium_mg_l:1.0, bicarbonate_mg_l:15.0, sulfate_mg_l:3.0, chlorure_mg_l:2.0, silice_mg_l:10.0, nitrate_mg_l:0.2, description:"L'eau en bouteille la plus populaire au Japon. Filtrée à travers le granite des Alpes du Sud japonaises, elle offre un goût ultra-doux typique des eaux nippones." },
  { id:'nongfu_spring', nom:'Nongfu Spring', pays:'Chine', ville_origine:'Lac des mille îles (Zhejiang)', entreprise:'Nongfu Spring Co., Ltd.', type_eau:'Plate', categorie:'Source', ph:7.3, tds_mg_l:55.0, calcium_mg_l:10.0, magnesium_mg_l:2.5, sodium_mg_l:8.0, potassium_mg_l:1.2, bicarbonate_mg_l:30.0, sulfate_mg_l:5.0, chlorure_mg_l:4.0, silice_mg_l:15.0, nitrate_mg_l:0.5, description:"Géant incontournable de l'eau en bouteille en Chine, prélevant ses eaux dans de grands parcs forestiers de montagne pour conserver les minéraux naturels." },
];

// ── Compute params + scores ───────────────────────────────────────────────────
function computeEntry(w, curated = false) {
  const params = {
    ca_hardness: w.calcium_mg_l    != null ? Math.round(w.calcium_mg_l    * 2.497  * 10) / 10 : null,
    alkalinity:  w.bicarbonate_mg_l != null ? Math.round(w.bicarbonate_mg_l * 0.8197 * 10) / 10 : null,
    ph:  w.ph,
    tds: w.tds_mg_l,
    na:  w.sodium_mg_l,
    cl:  w.chlorure_mg_l,
    cl2: 0,
  };
  const score = scoreFromParams(params);
  return { ...w, params, score, color: colorFromScore(score), label: labelFromScore(score), _curated: curated };
}

const WATERS = RAW.map(w => computeEntry(w, true));

// All waters = curated + mass (populated after fetch)
let ALL_WATERS = WATERS;
let massLoaded = false;

// Top pays by count (capped to top 25 for the filter pills)
function allPays() {
  const counts = {};
  for (const w of ALL_WATERS) counts[w.pays] = (counts[w.pays] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([p]) => p);
}

// ── State ─────────────────────────────────────────────────────────────────────
let S = {
  search: '',
  pays: new Set(),
  categorie: new Set(),
  type: new Set(),
  scoreRange: new Set(),
  durete: new Set(),
  sortCol: 'score',
  sortDir: 'desc',
  selectedId: null,
  page: 0,
  perPage: 50,
};

// ── Filtering + sorting ───────────────────────────────────────────────────────
function filtered() {
  return ALL_WATERS.filter(w => {
    if (S.search) {
      const q = S.search.toLowerCase();
      if (![w.nom, w.pays, w.ville_origine, w.entreprise].some(s => s.toLowerCase().includes(q))) return false;
    }
    if (S.pays.size      && !S.pays.has(w.pays))          return false;
    if (S.categorie.size && !S.categorie.has(w.categorie)) return false;
    if (S.type.size      && !S.type.has(w.type_eau))       return false;
    if (S.scoreRange.size) {
      const s = w.score ?? 0;
      if (!( (S.scoreRange.has('ideal')  && s >= 0.75) ||
             (S.scoreRange.has('accept') && s >= 0.50 && s < 0.75) ||
             (S.scoreRange.has('hors')   && s >= 0.25 && s < 0.50) ||
             (S.scoreRange.has('tres')   && s  < 0.25) )) return false;
    }
    if (S.durete.size) {
      const ca = w.params.ca_hardness ?? 0;
      if (!( (S.durete.has('tres_douce') && ca < 17) ||
             (S.durete.has('douce')      && ca >= 17 && ca < 50) ||
             (S.durete.has('ideale')     && ca >= 50 && ca <= 85) ||
             (S.durete.has('dure')       && ca > 85 && ca <= 170) ||
             (S.durete.has('tres_dure')  && ca > 170) )) return false;
    }
    return true;
  });
}

function sorted(list) {
  const dir = S.sortDir === 'asc' ? 1 : -1;
  const val = w => {
    switch (S.sortCol) {
      case 'nom':         return w.nom;
      case 'pays':        return w.pays;
      case 'score':       return w.score ?? -1;
      case 'ca_hardness': return w.params.ca_hardness ?? -1;
      case 'alkalinity':  return w.params.alkalinity ?? -1;
      case 'ph':          return w.ph ?? -1;
      case 'tds':         return w.tds_mg_l ?? -1;
      case 'na':          return w.sodium_mg_l ?? -1;
      default:            return 0;
    }
  };
  return [...list].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (typeof av === 'string') return av.localeCompare(bv, 'fr') * dir;
    return (av - bv) * dir;
  });
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderChart(vis) {
  const W=560, H=240, PL=46, PR=16, PT=20, PB=38;
  const CW=W-PL-PR, CH=H-PT-PB;
  const sx = v => PL + (Math.min(Math.max(v,0),160)/160)*CW;
  const sy = v => PT + CH - (Math.min(Math.max(v,0),120)/120)*CH;
  const f = n => n.toFixed(1);

  const visIds = new Set(vis.map(w => w.id));

  // Axes labels
  const axX = [0, 40, 70, 100, 160];
  const axY = [0, 17, 50, 68, 85, 120];
  const gridLines =
    [40,70].map(v=>`<line x1="${f(sx(v))}" y1="${f(PT)}" x2="${f(sx(v))}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width=".5" stroke-dasharray="2,2"/>`).join('')+
    [50,85].map(v=>`<line x1="${f(PL)}" y1="${f(sy(v))}" x2="${f(PL+CW)}" y2="${f(sy(v))}" stroke="var(--border)" stroke-width=".5" stroke-dasharray="2,2"/>`).join('');
  const xTicks = axX.map(v=>
    `<line x1="${f(sx(v))}" y1="${f(PT+CH)}" x2="${f(sx(v))}" y2="${f(PT+CH+3)}" stroke="var(--border)" stroke-width="1"/>
     <text x="${f(sx(v))}" y="${f(PT+CH+10)}" fill="var(--muted)" font-size="7" text-anchor="middle" font-family="sans-serif">${v}</text>`).join('');
  const yTicks = axY.filter(v=>v!==68).map(v=>
    `<line x1="${f(PL-3)}" y1="${f(sy(v))}" x2="${f(PL)}" y2="${f(sy(v))}" stroke="var(--border)" stroke-width="1"/>
     <text x="${f(PL-5)}" y="${f(sy(v)+2.5)}" fill="var(--muted)" font-size="7" text-anchor="end" font-family="sans-serif">${v}</text>`).join('');

  // Chart: curated dots (always) + filtered mass dots with Ca+Bic
  const chartWaters = ALL_WATERS.filter(w =>
    w._curated || (visIds.has(w.id) && w.params.ca_hardness != null && w.params.alkalinity != null)
  );
  const dots = chartWaters.map(w => {
    const { ca_hardness: ca, alkalinity: alk } = w.params;
    if (ca == null || alk == null) return '';
    const cx = sx(alk), cy = sy(ca);
    const inView    = visIds.has(w.id);
    const isSel     = w.id === S.selectedId;
    const isCurated = w._curated;
    const opacity = inView ? (isCurated ? 0.9 : 0.65) : 0.1;
    const r      = isSel ? 8 : (isCurated ? 5.5 : 3);
    const stroke = isSel ? 'white' : 'var(--bg)';
    const sw     = isSel ? 2.5 : (isCurated ? 1 : 0.5);
    const tip = `${w.nom} (${w.pays})\n${w.label} — ${w.score != null ? Math.round(w.score*100)+'%' : 'N/A'}\nCa: ${ca.toFixed(0)} | Alk: ${alk.toFixed(0)} mg/L CaCO₃`;
    return `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="${w.color}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${sw}" data-id="${_esc(w.id)}" style="cursor:pointer"><title>${_esc(tip)}</title></circle>`;
  }).join('');

  // Selected label
  const sel = S.selectedId ? WATERS.find(w => w.id === S.selectedId) : null;
  let selLabel = '';
  if (sel && sel.params.ca_hardness != null && sel.params.alkalinity != null) {
    const cx = sx(sel.params.alkalinity), cy = sy(sel.params.ca_hardness);
    const toRight = sel.params.alkalinity < 100, toBottom = sel.params.ca_hardness < 85;
    const lx = toRight ? cx + 10 : cx - 10;
    const ly = toBottom ? cy + 14 : cy - 7;
    selLabel = `<text x="${f(lx)}" y="${f(ly)}" fill="${sel.color}" font-size="8" font-weight="bold" font-family="sans-serif" text-anchor="${toRight ? 'start' : 'end'}">${_esc(sel.nom)}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible;display:block" id="sca-chart-svg">
    <rect width="${W}" height="${H}" fill="var(--bg)" rx="4"/>
    <!-- SCA zones -->
    <rect x="${f(sx(40))}" y="${f(sy(85))}" width="${f(sx(75)-sx(40))}" height="${f(sy(17)-sy(85))}" fill="var(--orange)" fill-opacity=".07" stroke="var(--orange)" stroke-width=".8" stroke-dasharray="3,2"/>
    <rect x="${f(sx(40))}" y="${f(sy(85))}" width="${f(sx(70)-sx(40))}" height="${f(sy(50)-sy(85))}" fill="var(--green)" fill-opacity=".11" stroke="var(--green)" stroke-width="1"/>
    <text x="${f(sx(55))}" y="${f(sy(67.5)+18)}" fill="var(--green)" fill-opacity=".6" font-size="8" font-weight="bold" text-anchor="middle" font-family="sans-serif">Idéal SCA</text>
    <!-- Grid -->
    ${gridLines}
    <line x1="${f(PL)}" y1="${f(PT+CH)}" x2="${f(PL+CW)}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
    <line x1="${f(PL)}" y1="${f(PT)}" x2="${f(PL)}" y2="${f(PT+CH)}" stroke="var(--border)" stroke-width="1"/>
    ${xTicks}${yTicks}
    <!-- Axis labels -->
    <text x="${f(PL+CW/2)}" y="${f(H-5)}" fill="var(--muted)" font-size="8" text-anchor="middle" font-family="sans-serif">Alcalinité (mg/L CaCO₃)</text>
    <text x="10" y="${f(PT+CH/2)}" fill="var(--muted)" font-size="8" text-anchor="middle" font-family="sans-serif" transform="rotate(-90,10,${f(PT+CH/2)})">Ca Hardness (mg/L CaCO₃)</text>
    <!-- SCA target -->
    <circle cx="${f(sx(55))}" cy="${f(sy(68))}" r="4" fill="var(--green)" fill-opacity=".5"/>
    <text x="${f(sx(55)+6)}" y="${f(sy(68)-5)}" fill="var(--green)" fill-opacity=".8" font-size="6.5" font-family="sans-serif">Cible 55/68</text>
    <!-- Waters -->
    ${dots}
    ${selLabel}
  </svg>`;
}

// ── Filters ───────────────────────────────────────────────────────────────────
function pill(label, active, key, val, group) {
  const cls = active ? 'season-pill active' : 'season-pill';
  return `<button class="${cls}" data-filter-group="${group}" data-filter-val="${_esc(String(val))}">${_esc(label)}</button>`;
}

function renderFilters() {
  const scoreOpts = [['Idéal ≥75%','ideal'],['Acceptable','accept'],['Hors plage','hors'],['Très hors SCA','tres']];
  const catOpts   = [...new Set(WATERS.map(w=>w.categorie))].sort();
  const typeOpts  = ['Plate','Gazeuse'];
  const durOpts   = [['Très douce <17','tres_douce'],['Douce 17–50','douce'],['Idéale SCA 50–85','ideale'],['Dure 85–170','dure'],['Très dure >170','tres_dure']];

  const cnt   = filtered().length;
  const total = ALL_WATERS.length;
  const loadBadge = massLoaded
    ? `<span class="b-count">${total.toLocaleString('fr-FR')} réf.</span>`
    : `<span class="b-count b-count-loading">⏳ Chargement…</span>`;
  return `
  <div class="b-filter-bar">
    <div class="b-search-row">
      <input id="b-search" type="text" placeholder="🔍  Rechercher eau, pays, source…" value="${_esc(S.search)}" autocomplete="off">
      <span class="b-count">${cnt.toLocaleString('fr-FR')} résultat${cnt!==1?'s':''}</span>
      ${loadBadge}
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Note SCA</span>
      <div class="season-pills">${scoreOpts.map(([l,v])=>pill(l,S.scoreRange.has(v),'scoreRange',v,'scoreRange')).join('')}</div>
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Type</span>
      <div class="season-pills">${typeOpts.map(v=>pill(v,S.type.has(v),'type',v,'type')).join('')}</div>
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Catégorie</span>
      <div class="season-pills">${catOpts.map(v=>pill(v,S.categorie.has(v),'categorie',v,'categorie')).join('')}</div>
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Dureté Ca</span>
      <div class="season-pills">${durOpts.map(([l,v])=>pill(l,S.durete.has(v),'durete',v,'durete')).join('')}</div>
    </div>
    <div class="b-filter-group">
      <span class="b-filter-label">Pays</span>
      <div class="season-pills b-pays-pills">${allPays().map(v=>pill(v,S.pays.has(v),'pays',v,'pays')).join('')}</div>
    </div>
  </div>`;
}

// ── Table ─────────────────────────────────────────────────────────────────────
const COLS = [
  { key:'nom',         label:'Nom',                   align:'left'  },
  { key:'pays',        label:'Pays',                  align:'left'  },
  { key:'score',       label:'Note SCA',              align:'right' },
  { key:'ca_hardness', label:'Ca Hardness',           align:'right' },
  { key:'alkalinity',  label:'Alcalinité',            align:'right' },
  { key:'ph',          label:'pH',                    align:'right' },
  { key:'tds',         label:'TDS',                   align:'right' },
  { key:'na',          label:'Na',                    align:'right' },
];

function cellVal(w, key) {
  switch (key) {
    case 'nom':         return _esc(w.nom);
    case 'pays':        return `<span class="b-type-badge">${_esc(w.type_eau[0])}</span> ${_esc(w.pays)}`;
    case 'score':
      if (w.score == null) return '<span class="b-val-na">—</span>';
      return `<span class="b-score-badge" style="background:${w.color}22;color:${w.color};border:1px solid ${w.color}55">${Math.round(w.score*100)}&thinsp;%</span>`;
    case 'ca_hardness': return w.params.ca_hardness != null ? `<span style="color:var(--text)">${w.params.ca_hardness.toFixed(0)}</span><span class="b-unit"> CaCO₃</span>` : '<span class="b-val-na">—</span>';
    case 'alkalinity':  return w.params.alkalinity  != null ? `<span style="color:var(--text)">${w.params.alkalinity.toFixed(0)}</span><span class="b-unit"> CaCO₃</span>` : '<span class="b-val-na">—</span>';
    case 'ph':          return w.ph  != null ? `<span style="color:var(--text)">${w.ph.toFixed(1)}</span>` : '<span class="b-val-na">—</span>';
    case 'tds':         return w.tds_mg_l != null ? `<span style="color:var(--text)">${w.tds_mg_l.toFixed(0)}</span><span class="b-unit"> mg/L</span>` : '<span class="b-val-na">—</span>';
    case 'na':          return w.sodium_mg_l != null ? `<span style="color:var(--text)">${w.sodium_mg_l.toFixed(1)}</span><span class="b-unit"> mg/L</span>` : '<span class="b-val-na">—</span>';
    default:            return '—';
  }
}

function renderDetail(w) {
  const p = w.params;
  const fmt = (v, dec=1) => v != null ? v.toFixed(dec) : '—';
  const paramRow = (label, val, unit='mg/L', inRange=null) => {
    const cls = inRange === true ? 'b-det-ok' : inRange === false ? 'b-det-warn' : '';
    return `<div class="b-det-row ${cls}"><span class="b-det-label">${label}</span><span class="b-det-val">${val != null ? val : '—'}${val != null && unit ? '<span class="b-unit"> '+unit+'</span>' : ''}</span></div>`;
  };
  const inSca = (v, lo, hi) => v != null ? (v >= lo && v <= hi) : null;

  const coffeeRec = () => {
    const tips = [];
    const ca = p.ca_hardness, alk = p.alkalinity;
    if (ca == null || alk == null) return '';
    if (ca >= 50 && ca <= 85 && alk >= 40 && alk <= 70)
      tips.push('✓ Profil SCA idéal — convient à toutes les méthodes');
    else if (ca < 30)
      tips.push('↑ Eau douce — favoriser l\'immersion (cafetière, cold brew)');
    else if (ca > 170)
      tips.push('↓ Eau très dure — préférer l\'espresso court, risque de calcaire');
    if (alk > 100)
      tips.push('↓ Alcalinité élevée — favoriser cafés fruités, éviter torréfactions claires');
    else if (alk < 30)
      tips.push('↑ Faible alcalinité — préférer torréfactions medium');
    if (w.tds_mg_l != null && w.tds_mg_l > 300)
      tips.push(`⚠ TDS élevé (${Math.round(w.tds_mg_l)} mg/L) — température réduite 88–91°C`);
    if (!tips.length) return '';
    return `<div class="b-det-section"><div class="b-det-title">Recommandations café</div>${tips.map(t=>`<div class="b-recipe-tip">${_esc(t)}</div>`).join('')}</div>`;
  };

  return `<div class="b-detail">
    <div class="b-det-header">
      <div>
        <div class="b-det-name">${_esc(w.nom)}</div>
        <div class="b-det-origin">${_esc(w.ville_origine)} · ${_esc(w.entreprise)}</div>
        <div class="b-det-type">${_esc(w.categorie)} · ${_esc(w.type_eau)}</div>
      </div>
      <div class="b-det-score" style="color:${w.color}">
        <div class="b-det-score-val">${w.score != null ? Math.round(w.score*100)+'%' : '—'}</div>
        <div class="b-det-score-lbl">${_esc(w.label)}</div>
      </div>
    </div>
    <div class="b-det-desc">${_esc(w.description)}</div>
    <div class="b-det-params">
      <div class="b-det-section">
        <div class="b-det-title">Paramètres SCA (unités CaCO₃)</div>
        ${paramRow('Ca Hardness', p.ca_hardness != null ? p.ca_hardness.toFixed(0) : null, 'mg/L CaCO₃', inSca(p.ca_hardness,50,85))}
        ${paramRow('Alcalinité',  p.alkalinity  != null ? p.alkalinity.toFixed(0)  : null, 'mg/L CaCO₃', inSca(p.alkalinity,40,70))}
        ${paramRow('pH',          w.ph  != null ? w.ph.toFixed(1)  : null, '', inSca(w.ph,6.5,7.5))}
        ${paramRow('TDS',         w.tds_mg_l != null ? Math.round(w.tds_mg_l).toString() : null, 'mg/L', inSca(w.tds_mg_l,75,250))}
        ${paramRow('Sodium',      w.sodium_mg_l != null ? w.sodium_mg_l.toFixed(1) : null, 'mg/L', inSca(w.sodium_mg_l,0,30))}
        ${paramRow('Chlorures',   w.chlorure_mg_l != null ? w.chlorure_mg_l.toFixed(1) : null, 'mg/L', inSca(w.chlorure_mg_l,0,75))}
      </div>
      <div class="b-det-section">
        <div class="b-det-title">Composition brute (étiquette)</div>
        ${paramRow('Calcium (Ca)',    w.calcium_mg_l != null ? w.calcium_mg_l.toFixed(1) : null)}
        ${paramRow('Magnésium (Mg)', w.magnesium_mg_l != null ? w.magnesium_mg_l.toFixed(1) : null)}
        ${paramRow('Potassium (K)',   w.potassium_mg_l != null ? w.potassium_mg_l.toFixed(1) : null)}
        ${paramRow('Bicarbonates',    w.bicarbonate_mg_l != null ? w.bicarbonate_mg_l.toFixed(0) : null)}
        ${paramRow('Sulfates',        w.sulfate_mg_l != null ? w.sulfate_mg_l.toFixed(0) : null)}
        ${paramRow('Silice',          w.silice_mg_l != null ? w.silice_mg_l.toFixed(1) : null)}
        ${paramRow('Nitrates',        w.nitrate_mg_l != null ? w.nitrate_mg_l.toFixed(1) : null)}
      </div>
    </div>
    ${coffeeRec()}
  </div>`;
}

function renderTable(vis) {
  const allSorted = sorted(vis);
  const total  = allSorted.length;
  const pages  = Math.max(1, Math.ceil(total / S.perPage));
  const page   = Math.min(S.page, pages - 1);
  const start  = page * S.perPage;
  const slice  = allSorted.slice(start, start + S.perPage);

  const rows = slice.map(w => {
    const isSel = w.id === S.selectedId;
    const cells = COLS.map(c =>
      `<td style="text-align:${c.align}">${cellVal(w, c.key)}</td>`).join('');
    const row = `<tr class="b-row${isSel?' b-row-sel':''}" data-id="${_esc(w.id)}">${cells}</tr>`;
    const detail = isSel ? `<tr class="b-detail-row"><td colspan="${COLS.length}">${renderDetail(w)}</td></tr>` : '';
    return row + detail;
  }).join('');

  const thSort = col => {
    const isActive = S.sortCol === col.key;
    const arrow = isActive ? (S.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="b-th${isActive?' b-th-active':''}" data-sort="${col.key}" style="text-align:${col.align}">${_esc(col.label)}${arrow}</th>`;
  };

  // Pagination footer
  const from = total === 0 ? 0 : start + 1;
  const to   = Math.min(start + S.perPage, total);
  const pager = `<div class="b-pager">
    <button class="b-pager-btn" data-page="${page-1}" ${page===0?'disabled':''}>←</button>
    <span class="b-pager-info">${from.toLocaleString('fr-FR')}–${to.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')}</span>
    <button class="b-pager-btn" data-page="${page+1}" ${page>=pages-1?'disabled':''}>→</button>
  </div>`;

  const noResults = `<tr><td colspan="${COLS.length}" class="b-no-results">Aucune eau ne correspond aux filtres</td></tr>`;

  return `<div class="b-table-wrap">
    <table class="b-table">
      <thead><tr>${COLS.map(thSort).join('')}</tr></thead>
      <tbody>${rows || noResults}</tbody>
    </table>
    ${total > S.perPage ? pager : ''}
  </div>`;
}

// ── Full render ───────────────────────────────────────────────────────────────
function render() {
  const vis = filtered();
  document.getElementById('chart-container').innerHTML  = renderChart(vis);
  document.getElementById('filter-container').innerHTML = renderFilters();
  document.getElementById('table-container').innerHTML  = renderTable(vis);

  // Scroll to detail row if selected
  if (S.selectedId) {
    const sel = document.querySelector('.b-row-sel');
    if (sel) sel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ── Event delegation ──────────────────────────────────────────────────────────
document.getElementById('chart-container').addEventListener('click', e => {
  const dot = e.target.closest('[data-id]');
  if (!dot) return;
  const id = dot.dataset.id;
  S.selectedId = S.selectedId === id ? null : id;
  render();
});

document.getElementById('filter-container').addEventListener('click', e => {
  const btn = e.target.closest('[data-filter-group]');
  if (!btn) return;
  const group = btn.dataset.filterGroup;
  const val   = btn.dataset.filterVal;
  const set   = S[group];
  set.has(val) ? set.delete(val) : set.add(val);
  S.page = 0;
  render();
});

document.getElementById('filter-container').addEventListener('input', e => {
  if (e.target.id === 'b-search') { S.search = e.target.value; S.page = 0; render(); }
});

document.getElementById('table-container').addEventListener('click', e => {
  const th = e.target.closest('[data-sort]');
  if (th) {
    const col = th.dataset.sort;
    if (S.sortCol === col) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
    else { S.sortCol = col; S.sortDir = col === 'nom' || col === 'pays' ? 'asc' : 'desc'; }
    S.page = 0;
    render();
    return;
  }
  const pgBtn = e.target.closest('[data-page]');
  if (pgBtn && !pgBtn.disabled) {
    S.page = parseInt(pgBtn.dataset.page, 10);
    render();
    document.getElementById('table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const row = e.target.closest('.b-row');
  if (row) {
    const id = row.dataset.id;
    S.selectedId = S.selectedId === id ? null : id;
    render();
  }
});

// ── Mass data loader ─────────────────────────────────────────────────────────
async function loadMassData() {
  try {
    const resp = await fetch('eaux_masse.json');
    const raw  = await resp.json();
    ALL_WATERS = [...WATERS, ...raw.map(w => computeEntry(w, false))];
    massLoaded = true;
    S.page = 0;
    render();
  } catch (e) {
    console.error('Failed to load mass data:', e);
    massLoaded = true;
    render();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
render();
loadMassData();
