export interface PersonaDef {
  id: string;
  label: string;
  imageUrl: string | null;
  height: string;
  bodyShape: string;
  skinTone: string;
}

export const PERSONAS_BY_BRAND: Record<string, PersonaDef[]> = {
  'DEEZ': [
    { id: 'deez-1', label: 'Edgy Streetwear', imageUrl: '/personas/deez_model_1.png', height: '5\'5" (165cm)', bodyShape: 'slim Sri Lankan build', skinTone: 'warm golden skin tone' },
    { id: 'deez-2', label: 'Smart Casual', imageUrl: '/personas/deez_model_2.png', height: '5\'8" (173cm)', bodyShape: 'slim athletic Sri Lankan build', skinTone: 'medium tan skin tone' },
    { id: 'deez-3', label: 'Sporty & Active', imageUrl: '/personas/deez_model_3.png', height: '5\'6" (168cm)', bodyShape: 'athletic Sri Lankan build', skinTone: 'rich brown skin tone' }
  ],
  'Happybuy': [
    { id: 'happybuy-1', label: 'Youthful & Bright', imageUrl: '/personas/happybuy_model_1.png', height: '5\'4" (162cm)', bodyShape: 'petite slim Sri Lankan build', skinTone: 'warm golden-tan skin tone' },
    { id: 'happybuy-2', label: 'Active & Cheerful', imageUrl: '/personas/happybuy_model_2.png', height: '5\'6" (168cm)', bodyShape: 'athletic healthy Sri Lankan build', skinTone: 'medium tan skin tone' },
    { id: 'happybuy-3', label: 'Curvy & Confident', imageUrl: '/personas/happybuy_model_3.png', height: '5\'7" (170cm)', bodyShape: 'curvy Sri Lankan build', skinTone: 'rich brown skin tone' }
  ],
  'Cleopatra': [
    { id: 'cleopatra-1', label: 'Statuesque Elegance', imageUrl: '/personas/cleopatra_model_1.png', height: '5\'10" (178cm)', bodyShape: 'very slim statuesque high-fashion build', skinTone: 'light golden skin tone' },
    { id: 'cleopatra-2', label: 'High-Fashion Hourglass', imageUrl: '/personas/cleopatra_model_2.png', height: '5\'9" (175cm)', bodyShape: 'hourglass high-fashion build', skinTone: 'warm olive skin tone' },
    { id: 'cleopatra-3', label: 'Tall & Athletic', imageUrl: '/personas/cleopatra_model_3.png', height: '5\'11" (180cm)', bodyShape: 'tall athletic build', skinTone: 'deep rich skin tone' }
  ],
  'Modabella': [
    { id: 'modabella-1', label: 'Average Professional', imageUrl: '/personas/modabella_model_1.png', height: '5\'7" (170cm)', bodyShape: 'average professional build', skinTone: 'medium light skin tone' },
    { id: 'modabella-2', label: 'Curvy Professional', imageUrl: '/personas/modabella_model_2.png', height: '5\'6" (168cm)', bodyShape: 'curvy professional build', skinTone: 'warm medium skin tone' },
    { id: 'modabella-3', label: 'Slim Professional', imageUrl: '/personas/modabella_model_3.png', height: '5\'8" (172cm)', bodyShape: 'slim professional build', skinTone: 'deep brown skin tone' }
  ]
};

export type PersonaId = string;

/** Resolve a persona without making brand casing or surrounding spaces significant. */
export function findPersonaForBrand(brand: string, personaId: string): PersonaDef | undefined {
  const normalizedBrand = brand.trim().toLowerCase();
  const brandKey = Object.keys(PERSONAS_BY_BRAND)
    .find(key => key.toLowerCase() === normalizedBrand);

  return brandKey
    ? PERSONAS_BY_BRAND[brandKey].find(persona => persona.id === personaId)
    : undefined;
}
