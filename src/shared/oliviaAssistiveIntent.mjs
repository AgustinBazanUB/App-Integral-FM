const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Routing does not grant authority. Even a misclassified mixed request must go
// through the same business tools, guards and visual confirmation.
export function assistiveIntent(message, previous = null) {
  const text = normalize(message);
  const technical = /(?:escrib|genera|crea|explica|ejemplo|ayud).*(?:funcion (?:en |para )|javascript|typescript|python|codigo fuente|programa|fragmento de codigo|html|css|sql)|\b(?:debug|depura|programacion|pseudocodigo)\b/.test(text);
  const data = /\b(?:vendimos|facturamos|ventas registradas|nuestros datos|mis ventas)\b|(?:revisa|consulta|analiza|mostra|usa|con|segun|basad[oa]).*(?:ventas (?:reales|de|del|actuales)|datos (?:reales|actuales|del negocio)|stock (?:real|actual)|metricas)|cuanto.*(?:vendimos|facturamos)|ventas (?:de hoy|de ayer|de esta|del mes)|stock (?:actual|disponible)|(?:quedan|tenemos).*(?:unidades|stock)/.test(text);
  const save = /\b(?:registr[a-z]*|guard[a-z]*|carg[a-z]*|transfer[a-z]*|vendeme|cobra[a-z]*|publica[a-z]*|envia[a-z]*)\b|\b(?:crea(?:la|lo|las|los)|crea[a-z]* .*en (?:el )?(?:sistema|aplicacion)|da(?:r)? de alta)\b|\b(?:crea(?:me)?|crear|creemos) (?:una? |(?:la|el) )?(?:feria|ubicacion|evento|cliente|producto|deposito|venta|gasto|proveedor)\b/.test(text);
  const ideas = /\b(?:inventa(?:me|r|mos|lo|te)?|idea[a-z]*|sugeri[a-z]*|propon[a-z]*|pensa[a-z]*|imagina[a-z]*|brainstorm|redact[a-z]*|reescrib[a-z]*|borrador|prompt|copywriting)\b|(?:que|cual).*(?:nombre|codigo|promocion|estrategia).*(?:poner|recomen|usar|usaramos)|(?:crea|genera|dame|hace|disena).*(?:nombres?|codigos?|abreviaturas?|identificadores?|ideas?|textos?|descripcion|documentacion|instrucciones|prompts?|mensaje|campana creativa|concepto|post|carrusel|reel|guion|banner)|(?:quiero|vamos a) (?:organizar|poner|pensar) una feria/.test(text);
  const revision = previous && /^(?:ese nombre|esa propuesta|esa idea|eso me gusta|me gusta|me quedo con|hacelo (?:mas|de)|hacela (?:mas|de)|cambialo|acortalo|mas (?:elegante|cort[oa]|comercial)|otra (?:opcion|version)|otras opciones|la (?:segunda|primera|tercera)\b)/.test(text);
  if (technical && !data && !/\b(?:ejecuta|desplega|modifica los archivos)\b/.test(text)) return { kind: 'technical', pure: true };
  if (data && (ideas || revision)) return { kind: 'mixed', pure: false };
  const recommendation = /que (?:me )?recomendas/.test(text) && /promocion|campana|estrategia|aumentar.*ventas|idea/.test(text);
  if (!save && !data && (ideas || revision || recommendation)) return { kind: 'creative', pure: true };
  if (/^(?:hola )?(?:que podes hacer|para que servis|como me podes ayudar)$/.test(text)) return { kind: 'general', pure: true };
  return { kind: 'business', pure: false };
}
