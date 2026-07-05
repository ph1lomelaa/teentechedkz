class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = []
    this._bufferLength = 0
  }

  process(inputs) {
    const input = inputs[0]
    const channel = input && input[0]
    if (!channel) return true

    this._buffer.push(new Float32Array(channel))
    this._bufferLength += channel.length

    if (this._bufferLength >= 4096) {
      const merged = new Float32Array(this._bufferLength)
      let offset = 0
      for (const chunk of this._buffer) {
        merged.set(chunk, offset)
        offset += chunk.length
      }
      this.port.postMessage(merged, [merged.buffer])
      this._buffer = []
      this._bufferLength = 0
    }

    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
