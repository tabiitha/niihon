import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { contrastRatio } from './contrast.ts';
import { colorRoles, resolveColorMode, themes, themeVariables, type ColorMode, type ColorRole } from './themes.ts';

const themesDirectory = fileURLToPath(new URL('../../../../resources/themes/', import.meta.url));
const modes: readonly ColorMode[] = ['light', 'dark'];

// Pairs every theme must declare, so that a theme cannot pass by omitting a check.
const requiredPairs: ReadonlyArray<readonly [ColorRole, ColorRole, number]> = [
  ['text', 'background', 4.5],
  ['text', 'backgroundAccent', 4.5],
  ['textMuted', 'background', 4.5],
  ['textMuted', 'backgroundAccent', 4.5],
  ['accentText', 'background', 4.5],
  ['accentText', 'backgroundAccent', 4.5],
  ['onAccent', 'accent', 4.5],
  ['onSurface', 'surface', 4.5],
  ['focus', 'background', 3],
  ['focus', 'backgroundAccent', 3],
  ['error', 'background', 4.5],
  ['error', 'backgroundAccent', 4.5],
];

/** `color-mix(in srgb, first share%, second)`, as the stylesheet mixes the card background. */
function mix(first: string, second: string, share: number): string {
  const channel = (color: string, index: number) => Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16);
  return `#${[0, 1, 2]
    .map((index) => Math.round(channel(first, index) * share + channel(second, index) * (1 - share)).toString(16).padStart(2, '0'))
    .join('')}`;
}

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
    assert.equal(contrastRatio('#777777', '#777777'), 1);
    assert.equal(contrastRatio('#767676', '#FFFFFF').toFixed(2), '4.54');
  });
});

describe('themes', () => {
  it('registers every theme folder under resources/themes', () => {
    const folders = readdirSync(themesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(themes.map((theme) => theme.id).sort(), folders);
  });

  for (const theme of themes) {
    it(`${theme.id} defines every color role in both modes`, () => {
      for (const mode of modes) {
        assert.deepEqual(Object.keys(theme.modes[mode].colors).sort(), [...colorRoles].sort(), `${theme.id} ${mode}`);
        for (const role of colorRoles) {
          assert.match(theme.modes[mode].colors[role], /^#[0-9A-F]{6}$/i, `${theme.id} ${mode} ${role}`);
        }
      }
    });

    it(`${theme.id} meets the WCAG 2.2 AA contrast target in both modes`, () => {
      for (const [foreground, background, minimum] of requiredPairs) {
        const declared = theme.contrastPairs.find((pair) => pair.foreground === foreground && pair.background === background);
        assert.ok(declared !== undefined && declared.minimum >= minimum, `${theme.id} must declare ${foreground}/${background} ≥ ${minimum}`);
      }
      for (const mode of modes) {
        const { colors } = theme.modes[mode];
        for (const { foreground, background, minimum } of theme.contrastPairs) {
          const ratio = contrastRatio(colors[foreground], colors[background]);
          assert.ok(ratio >= minimum, `${theme.id} ${mode}: ${foreground} on ${background} is ${ratio.toFixed(2)}, below ${minimum}`);
        }
      }
    });
  }

  for (const theme of themes) {
    it(`${theme.id} error color is readable on the account card, and its field border visible`, () => {
      // styles.css: the card is the surface at 78% (light) or the background at 88% (dark) over the page gradient,
      // which goes from the background to the background accent; both ends are checked.
      for (const mode of modes) {
        const { colors } = theme.modes[mode];
        const [card, share] = mode === 'light' ? [colors.surface, 0.78] : [colors.background, 0.88];
        for (const behind of [colors.background, colors.backgroundAccent]) {
          const ratio = contrastRatio(colors.error, mix(card, behind, share));
          assert.ok(ratio >= 4.5, `${theme.id} ${mode}: error text on the card is ${ratio.toFixed(2)}, below 4.5`);
          assert.ok(ratio >= 3, `${theme.id} ${mode}: the error border on the card is ${ratio.toFixed(2)}, below 3`);
        }
      }
    });
  }

  it('turns tokens into CSS variables', () => {
    const theme = themes[0]!;
    const variables = themeVariables(theme, 'dark');
    assert.equal(variables['--color-background-accent'], theme.modes.dark.colors.backgroundAccent);
    assert.equal(Object.keys(variables).length, colorRoles.length);
  });

  it('follows the system setting only in system mode', () => {
    assert.equal(resolveColorMode('system', true), 'dark');
    assert.equal(resolveColorMode('system', false), 'light');
    assert.equal(resolveColorMode('light', true), 'light');
    assert.equal(resolveColorMode('dark', false), 'dark');
  });
});
