export const EXPRESSION_VERSION = '2026-10-30.1';
export const NATURAL_EXPRESSIONS = Object.freeze({
  understanding: ['Dale, entiendo.', 'Claro, vamos con eso.', 'Sí, te sigo.'],
  guide: ['Bien, te muestro.', 'Dale, te acompaño.', 'Vamos paso a paso.'],
  proposal: ['Te propongo estas opciones.', 'Podemos pensarlo así.', 'Probemos con estas ideas.'],
  clarification: ['Decime un poquito más.', 'Para orientarte bien, necesito una cosa.', 'Vamos con ese detalle.'],
});
export function chooseExpression(intent, messages = [], offset = 0) {
  const bank = NATURAL_EXPRESSIONS[intent] || NATURAL_EXPRESSIONS.understanding;
  const recent = messages.slice(-8).filter(row => row.role === 'assistant').map(row => row.content).join(' ');
  const candidates = bank.filter(phrase => !recent.includes(phrase));
  return (candidates.length ? candidates : bank)[Math.abs(offset) % (candidates.length || bank.length)];
}
export function naturalStyleContext(messages) {
  return { version: EXPRESSION_VERSION, examples: ['understanding', 'guide', 'proposal'].map(kind => chooseExpression(kind, messages)), instruction: 'Ejemplos de tono, no prefijos obligatorios. Usá voseo natural; no saludes de nuevo ni repitas muletillas. La respuesta útil tiene prioridad.' };
}
