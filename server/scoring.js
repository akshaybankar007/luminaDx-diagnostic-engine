export function calculateIAIHG(p) {
  let score = 0;
  const breakdown = [];

  const add = (criterion, points) => {
    if (points !== 0) {
      score += points;
      breakdown.push({ criterion, points });
    }
  };

  if (p.sex === 'female') add('Female Sex', 2);

  // ALP:AST/ALT Ratio
  const astOrAlt = Number(p.ast) || Number(p.alt);
  const alp = Number(p.alp);
  if (alp && astOrAlt) {
    const ratio = alp / astOrAlt;
    if (ratio < 1.5) add('ALP:AST/ALT Ratio < 1.5', 2);
    else if (ratio > 3.0) add('ALP:AST/ALT Ratio > 3.0', -2);
  }

  // IgG (Assuming standard ULN = 16 g/L)
  const igg = Number(p.igg);
  if (igg) {
    const ratio = igg / 16;
    if (ratio > 2.0) add('IgG > 2.0x Normal', 3);
    else if (ratio >= 1.5) add('IgG 1.5-2.0x Normal', 2);
    else if (ratio >= 1.0) add('IgG 1.0-1.5x Normal', 1);
  }

  // Autoantibodies (Max of ANA, ASMA, Anti-LKM1)
  const scoreTiter = (t) => t === '>=1:160' || t === '>=1:80' ? 3 : t === '1:80' ? 2 : t === '1:40' ? 1 : 0;
  const anaPts  = scoreTiter(p.anaTiter);
  const asmaPts = scoreTiter(p.asmaTiter);
  const lkmPts  = scoreTiter(p.antiLkm1);
  const maxPts  = Math.max(anaPts, asmaPts, lkmPts);
  
  if (maxPts === 3) add('Autoantibodies ≥ 1:80 (or 1:160)', 3);
  else if (maxPts === 2) add('Autoantibodies 1:80', 2);
  else if (maxPts === 1) add('Autoantibodies 1:40', 1);

  // AMA
  if (p.ama === 'positive') add('AMA Positive', -4);

  // Viral Markers
  if (p.hbsag === 'positive' || p.antiHcv === 'positive') add('Viral Markers Positive', -3);
  else if (p.hbsag === 'negative' && p.antiHcv === 'negative') add('Viral Markers Negative', 3);

  // Drug History
  if (p.dili === 'yes') add('Positive Drug History', -4);
  else if (p.dili === 'no') add('Negative Drug History', 1);

  // Alcohol Intake
  if (p.alcoholIntake === '<25g/day') add('Alcohol < 25g/day', 2);
  else if (p.alcoholIntake === '>60g/day') add('Alcohol > 60g/day', -2);

  // Other Autoimmune Diseases
  if (p.otherAutoimmune === 'yes') add('Concurrent Autoimmune Disease', 2);


  if (p.hla === 'yes' || p.hla === 'positive') add('HLA DR3/DR4', 1);

  // 11. Histology
  let histoCount = 0;
  const biopsyDone = p.interfaceHepatitis !== 'not-done' && p.rosette !== 'not-done';

  if (p.interfaceHepatitis === 'present') { add('Interface Hepatitis', 3); histoCount++; }
  if (p.plasmaCells === 'present') { add('Lymphoplasmacytic Infiltrate', 1); histoCount++; }
  if (p.rosette === 'present') { add('Rosette Formation', 1); histoCount++; }
  if (p.biliaryChanges === 'present') add('Biliary Changes', -3);
  if (p.atypicalHistology === 'present') add('Atypical Histology', -3);

  if (biopsyDone && histoCount === 0 && p.interfaceHepatitis === 'absent' && p.plasmaCells === 'absent' && p.rosette === 'absent') {
    add('No typical histological features', -5);
  }

  // Classification Thresholds
  let classification = 'Not AIH';
  // Adjust threshold if patient is already on treatment
  const isPostTreatment = p.treatmentStatus === 'post' || p.treatmentStatus === 'on-treatment';
  const definiteThreshold = isPostTreatment ? 17 : 15;
  const probableThreshold = isPostTreatment ? 12 : 10;

  if (score > definiteThreshold) classification = 'Definite AIH';
  else if (score >= probableThreshold) classification = 'Probable AIH';

  return { score, classification, breakdown };
}