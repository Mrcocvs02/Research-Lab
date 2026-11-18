import type { TFunction } from 'i18next';
import { ANNOTATION_COLORS } from '@rl/core';
import { useApp } from '../../state/app-context';
import type { AnnotationColor } from './geometry';

const NONE: readonly string[] = ['', '', '', '', ''];

/** What the user says each of the five colours means (`library.json`, `annotations.colorMeanings`; feature 36). */
export function useColorMeanings(): readonly string[] {
  return useApp().config?.annotations.colorMeanings ?? NONE;
}

/** The meaning of one colour, or `''` when the user gave none. */
export const meaningOf = (meanings: readonly string[], color: AnnotationColor): string => (meanings[ANNOTATION_COLORS.indexOf(color)] ?? '').trim();

/** "Yellow: Key result" with a meaning, just "Yellow" without one (as before the feature). */
export function colorName(t: TFunction, color: AnnotationColor, meanings: readonly string[]): string {
  const meaning = meaningOf(meanings, color);
  const name = t(`reader.colors.${color}`);
  return meaning ? t('reader.colorMeaning.tip', { color: name, meaning }) : name;
}
