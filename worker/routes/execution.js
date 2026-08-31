import { executeSignalById } from "../services/execution.js"


export async function handleExecuteSignal(
  request,
  env,
  id
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    )
  }

  const result =
    await executeSignalById(env, id)

  if (!result.executed) {
    return Response.json(
      result,
      { status: 409 }
    )
  }

  return Response.json(result)
}