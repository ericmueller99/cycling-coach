import type { ZwiftCategory } from '@cycling-coach/shared';
import type { CSSProperties } from 'react';

export interface CategoryColors {
  /** Badge fill. */
  bg: string;
  /** Text on the badge. */
  fg: string;
  /** A light wash of `bg`, for a highlighted row. */
  tint: string;
  /** A darker shade for coloured text on a light background. */
  ink: string;
}

const colors = (bg: string, fg: string, ink: string, tintAlpha = '1F'): CategoryColors => ({ bg, fg, ink, tint: `${bg}${tintAlpha}` });

/**
 * Zwift's own category colours (A+ black, A red, B green, C blue, D yellow, E purple), a shade darker
 * than in game so bold white letters stay readable (DECISIONS #115).
 */
export const ZWIFT_CATEGORY_COLORS: Record<ZwiftCategory, CategoryColors> = {
  // Black at the others' 12% reads as a heavy grey; 7% matches their weight.
  'A+': colors('#0E1014', '#FFFFFF', '#0E1014', '12'),
  A: colors('#E03A32', '#FFFFFF', '#B3261E'),
  B: colors('#2F9E44', '#FFFFFF', '#237A34'),
  C: colors('#1C8ED6', '#FFFFFF', '#1569A3'),
  D: colors('#F2C200', '#0E1014', '#8A6D00'),
  E: colors('#7B3FB5', '#FFFFFF', '#5E2F8C'),
};

/** A category badge's fill and text. */
export const categoryBadge = (c: ZwiftCategory): CSSProperties => ({ background: ZWIFT_CATEGORY_COLORS[c].bg, color: ZWIFT_CATEGORY_COLORS[c].fg });

const PEN_CATEGORIES: readonly ZwiftCategory[] = ['A', 'B', 'C', 'D', 'E'];

/** An event pen's category from Zwift's subgroup label (1–5 = A–E). */
export const penCategory = (label: number): ZwiftCategory | undefined => PEN_CATEGORIES[label - 1];
