export function buildDiagnosticPrompt(p, calc) {
  return `
You are a hepatology AI.
Deterministic math is done. DO NOT recalculate.

score: ${calc.score}
class: ${calc.classification}

patient: ${p.name} | ${p.age} | ${p.sex}
labs: ANA ${p.anaTiter} | ASMA ${p.asmaTiter} | LKM1 ${p.antiLkm1} | AMA ${p.ama}
igg: ${p.igg} | alt: ${p.alt} | ast: ${p.ast} | alp: ${p.alp}
viral: ${p.hbsag}/${p.antiHcv} | dili: ${p.dili} | alcohol: ${p.alcoholIntake} | autoimmune: ${p.otherAutoimmune}
histo notes: ${p.histoNotes || 'none'}
clinical notes: ${p.clinicalNotes || 'none'}

Task:
Generate json with exactly these 4 keys:
1. confidence (integer 0-100 based on data completeness)
2. treatmentIndication (string)
3. narrative (short clinical summary)
4. recommendations (array of strings)
`.trim();
}