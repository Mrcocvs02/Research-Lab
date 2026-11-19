import i18n from '../../i18n';

/** Money and size figures of the AI interface (estimates, so rounded), in the language of the app (D-441). */
export function formatUsd(usd: number): string {
  const money = (n: number) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD' }).format(n);
  return usd > 0 && usd < 0.01 ? `<${money(0.01)}` : money(usd);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: n < 10_000 ? 1 : 0, minimumFractionDigits: n < 10_000 ? 1 : 0 }).format(n / 1000);
  return `${k}k`;
}
