import type { IssueLanguage } from '../api/types'

/** Languages Gemini drafts in, by their own names (JAPAC crews often don't share the supervisor's language). */
export const LANGUAGES: [IssueLanguage, string][] = [
  ['en', 'English'], ['th', 'ไทย · Thai'], ['my', 'မြန်မာ · Burmese'], ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'],
  ['vi', 'Tiếng Việt · Vietnamese'], ['zh', '中文 · Chinese'], ['ja', '日本語 · Japanese'],
]
