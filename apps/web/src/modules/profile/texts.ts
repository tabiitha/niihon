import { defineTexts } from '../../i18n/texts.ts';
import en from './locales/en.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };

export const profileTexts = defineTexts<keyof typeof en>('profile', { en, fr, ja });
