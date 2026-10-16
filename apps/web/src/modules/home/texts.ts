import { defineTexts } from '../../i18n/texts.ts';
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };

export const homeTexts = defineTexts<keyof typeof en>('home', { en, fr, ja });
