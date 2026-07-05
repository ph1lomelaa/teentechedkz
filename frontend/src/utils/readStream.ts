export async function readTextStream(
  response: Response,
  onChunk: (text: string) => void,
): Promise<string> {
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  let finished = false
  while (!finished) {
    const { done, value } = await reader.read()
    if (done) {
      finished = true
      continue
    }
    const chunk = decoder.decode(value, { stream: true })
    fullText += chunk
    onChunk(fullText)
  }

  fullText += decoder.decode()
  onChunk(fullText)
  return fullText
}
