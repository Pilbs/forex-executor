const OANDA_BASE_URL = "https://api-fxpractice.oanda.com"

export async function getAccountSummary(env) {
  if (!env.OANDA_API_TOKEN) {
    throw new Error("OANDA_API_TOKEN is not configured")
  }

  if (!env.OANDA_ACCOUNT_ID) {
    throw new Error("OANDA_ACCOUNT_ID is not configured")
  }

  const response = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/summary`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.errorMessage || `OANDA request failed: ${response.status}`
    )
  }

  return data
}