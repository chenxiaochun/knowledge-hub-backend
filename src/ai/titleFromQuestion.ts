export const DEFAULT_TITLE = '新对话';

export function titleFromQuestion(question: string) {
  const text = question.replace(/\s+/g, ' ').trim();
  if (!text) return DEFAULT_TITLE;
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}
