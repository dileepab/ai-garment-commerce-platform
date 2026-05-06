export interface PersonaDef {
  id: string;
  label: string;
  imageUrl: string | null;
  height: string;
  bodyShape: string;
  skinTone: string;
}

export const PERSONAS_BY_BRAND: Record<string, PersonaDef[]> = {
  'Happyby': [
    { id: 'happyby-1', label: 'Casual & Youthful', imageUrl: '/personas/happyby_model_1.png', height: '5\'4" (162cm)', bodyShape: 'petite slim build', skinTone: 'light olive skin tone' },
    { id: 'happyby-2', label: 'Athletic Casual', imageUrl: '/personas/happyby_model_2.png', height: '5\'6" (168cm)', bodyShape: 'athletic build', skinTone: 'warm medium brown skin tone' },
    { id: 'happyby-3', label: 'Curvy Casual', imageUrl: '/personas/happyby_model_3.png', height: '5\'7" (170cm)', bodyShape: 'curvy build', skinTone: 'deep brown skin tone' }
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
