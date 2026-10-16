import { defineTexts } from '../../i18n/texts.ts';
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };

export const libraryTexts = defineTexts<keyof typeof en>('library', { en, fr, ja });
