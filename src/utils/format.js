export function formatMoney(value, currency = "GBP") {
  if (value === null || value === undefined) {
    return "—"
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value))
}


export function formatDateTime(value) {
  if (!value) {
    return "—"
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value))
}