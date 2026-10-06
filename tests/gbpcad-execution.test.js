import test from "node:test"
import assert from "node:assert/strict"

import { validateSignal } from "../worker/validation/signal.js"

function payload(overrides = {}) {
  return {
    signalId: "gbpcad-test-1",
    strategyName: "GBP_CAD_TEST",
    instrument: "GBP_CAD",
    direction: "buy",
    units: 1000,
    stopLoss: 1.8,
    takeProfit: 1.83,
    ...overrides,
  }
}

test("GBP_CAD requires live enable flag", () => {
  const errors = validateSignal(payload(), {})
  assert.ok(errors.includes("GBP_CAD live execution is not enabled"))
})

test("GBP_CAD requires max units", () => {
  const errors = validateSignal(payload(), {
    GBP_CAD_LIVE_ENABLED: "true",
  })
  assert.ok(
    errors.includes(
      "GBP_CAD_MAX_UNITS must be configured as a positive integer"
    )
  )
})

test("GBP_CAD enforces max units and stop loss", () => {
  const env = {
    GBP_CAD_LIVE_ENABLED: "true",
    GBP_CAD_MAX_UNITS: "2000",
  }

  assert.deepEqual(validateSignal(payload({ units: 2000 }), env), [])

  assert.ok(
    validateSignal(payload({ units: 2001 }), env).includes(
      "units cannot exceed 2000 for GBP_CAD"
    )
  )

  assert.ok(
    validateSignal(payload({ stopLoss: undefined }), env).includes(
      "stopLoss is required for GBP_CAD live execution"
    )
  )
})
