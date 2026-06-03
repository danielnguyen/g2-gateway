export function paginateText(text: string, maxPageChars = 320): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return ['No response.'];
  }

  const pages: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxPageChars) {
    const window = remaining.slice(0, maxPageChars + 1);
    const breakAt = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('; '),
      window.lastIndexOf(', '),
      window.lastIndexOf(' ')
    );

    const splitAt = breakAt > maxPageChars * 0.5 ? breakAt + 1 : maxPageChars;
    pages.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    pages.push(remaining);
  }

  return pages;
}
