/**
 * 把模型 delta 累積到完整段落才交付 Discord。
 * 只以換行分段；句號、問號、驚嘆號和音樂符號都保留在同一則訊息。
 */
export class StreamingTextSegmenter {
  private buffer = "";

  push(delta: string): string[] {
    if (delta) this.buffer += delta;
    return this.takeCompleteSegments();
  }

  finish(): string[] {
    const complete = this.takeCompleteSegments();
    const tail = this.buffer.trim();
    this.buffer = "";
    return tail ? [...complete, tail] : complete;
  }

  private takeCompleteSegments(): string[] {
    const segments: string[] = [];

    while (this.buffer) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      let next = newline + 1;
      while (next < this.buffer.length && this.buffer[next] === "\n") next++;
      const segment = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(next);
      if (segment) segments.push(segment);
    }
    return segments;
  }
}
