export const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'ko', label: 'Korean' },
];

const LANGUAGE_LABELS = new Map(LANGUAGE_OPTIONS.map((option) => [option.code, option.label]));

export function languageLabel(code?: string): string {
  if (!code) {
    return 'Other';
  }
  return LANGUAGE_LABELS.get(code.toLowerCase()) ?? code;
}
