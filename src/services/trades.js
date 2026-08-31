export async function getOpenTrades() {
  const response = await fetch("/api/oanda/trades/open")

  if (!response.ok) {
    throw new Error("Failed to load open trades")
  }

  return response.json()
}


export async function getClosedTrades() {
  const response = await fetch("/api/oanda/trades/closed")

  if (!response.ok) {
    throw new Error("Failed to load closed trades")
  }

  return response.json()
}