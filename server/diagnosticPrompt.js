// server/diagnosticPrompt.js

export function buildDiagnosticPrompt(patient, scoringResult) {
  return `
You are a specialist hepatologist AI. The patient's data has already been deterministically scored against the IAIHG Revised Original Scoring System by the backend engine.

---
DETERMINISTIC SCORING RESULTS (DO NOT RECALCULATE):
Total IAIHG Score: ${scoringResult.score}
Classification: ${scoringResult.classification}
Breakdown: ${JSON.stringify(scoringResult.breakdown)}

---
PATIENT DATA:
Name: ${patient.name} | Age: ${patient.age} | Sex: ${patient.sex}
ANA: ${patient.anaTiter} | ASMA: ${patient.asmaTiter} | Anti-LKM1: ${patient.antiLkm1} | AMA: ${patient.ama}
IgG: ${patient.igg} | ALT: ${patient.alt} | AST: ${patient.ast} | ALP: ${patient.alp}
Viral (HBsAg/HCV): ${patient.hbsag}/${patient.antiHcv} | DILI: ${patient.dili} | Alcohol: ${patient.alcohol}
Histology Notes: ${patient.histoNotes || 'None'}
Clinical Notes: ${patient.clinicalNotes || 'None'}

---
YOUR TASK:
Generate a valid JSON object matching the required schema. 
1. You MUST copy the exact "iaihgScore", "classification", and "scoreBreakdown" provided above into your JSON response. Do not alter them.
2. Calculate a "confidence" percentage (0-100) based on the completeness of the data.
3. State a "treatmentIndication".
4. Write a "narrative" (3-5 sentences) summarizing the clinical picture based on the inputs and score.
5. Provide 3-5 specific clinical "recommendations".
`.trim();
}