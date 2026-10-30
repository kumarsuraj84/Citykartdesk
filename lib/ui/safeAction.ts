// Server actions are calls over the network. When the internet drops, the server restarts after an update, or a file is too big,
// the call does not return an answer, it throws. Inside a button handler that throw would blank the whole page.
// safely() turns such a throw into the same { error } answer the actions already give for a refusal, so each screen can show it
// next to its own button and keep what the person typed.

export const NETWORK_ERROR_MESSAGE = 'Could not reach the server. Check your internet and try again.'

export async function safely<T extends { error?: string }>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch {
    return { error: NETWORK_ERROR_MESSAGE } as T
  }
}
