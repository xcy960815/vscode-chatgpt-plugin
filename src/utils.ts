/**
 * @desc 这个方法的作用是将一个 ReadableStream 对象转换成一个异步迭代器 AsyncIterable，该迭代器会在每次迭代中返回一个 Uint8Array 类型的数据块。具体来说，该方法会获取一个 ReadableStream 对象的读取器（reader），然后在一个无限循环中等待读取器返回数据。每次读取器返回数据时，该方法都会返回一个包含数据的 Uint8Array 对象。当读取器返回一个 done 属性为 true 的对象时，该方法就会结束迭代。最后，该方法会释放读取器的锁。
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {AsyncIterable<Uint8Array>}
 */
export async function* streamAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
