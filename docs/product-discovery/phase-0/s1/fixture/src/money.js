const SYMBOLS = { USD: "$", EUR: "€", GBP: "£" };

/** Format integer cents as a currency string, e.g. 123456 → "$1,234.56". */
export function formatMoney(cents, currency = "USD") {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  const whole = Math.trunc(cents / 100);
  const frac = String(Math.abs(cents % 100)).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${symbol}${grouped}.${frac}`;
}

/** Parse "$1,234.50", "1234.5" or "-$5" into integer cents. */
export function parseMoney(text) {
  const t = String(text).trim();
  const negative = t.startsWith("-");
  const digits = t.replace(/[^0-9.]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) throw new Error(`Not a money amount: ${text}`);
  const [w, f = ""] = digits.split(".");
  const cents = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return negative ? -cents : cents;
}
