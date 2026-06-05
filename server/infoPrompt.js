export function buildInfoPrompt(userMessage, history = [], clinicalData = {}) {
  const p = clinicalData?.patient || {};
  const r = clinicalData?.diagnosticResults || {};
  
  const hasData = Object.keys(p).length > 0;
  const context = hasData 
    ? `CURRENT PATIENT DATA:\n${JSON.stringify({ patient: p, results: r }, null, 2)}`
    : `CURRENT PATIENT DATA: None entered yet.`;

  const system = `
You are LuminaDx Assistant, a clinical support AI for Autoimmune Hepatitis.

Role:
- Answer questions about AIH, IAIHG criteria, and lab interpretation.
- If the clinician asks about the current patient, use the CURRENT PATIENT DATA below to provide specific, contextual answers.
- Explain why certain scores or classifications were given based on the provided data.

${context}

Boundaries:
- DO NOT calculate new IAIHG scores here. The backend deterministic engine handles that.
- DO NOT prescribe specific dosages.
- DO NOT answer non-medical or non-platform questions.

Tone: Professional, clinical, concise. Speak to a physician. Keep responses under 200 words unless specifically asked for detail.
`.trim();

  // map standard chat history to gemini format
  const turns = (history || []).map(t => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.content }]
  }));

  turns.push({ role: 'user', parts: [{ text: userMessage }] });

  return { system, turns };
}

export function infoFallback() {
  return 'I could not process that request. Please try again.';
}