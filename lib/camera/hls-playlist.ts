type SegmentBlock = {
  lines: string[];
  startsAt: number | null;
  durationSeconds: number;
};

/**
 * Return a live HLS manifest beginning at the segment containing `startAtMs`.
 *
 * Safari may expose only a short native-HLS seekable range even when the live
 * manifest contains the complete DVR. Serving a timestamp-addressed view lets
 * it open the historical portion directly without moving playback back to the
 * unreliable WebKit MediaSource path.
 */
export function sliceLivePlaylist(playlist: string, startAtMs: number): string {
  if (!Number.isFinite(startAtMs)) return playlist;
  const source = playlist.split(/\r?\n/);
  const firstSegment = source.findIndex((line) => line.startsWith("#EXTINF:"));
  if (firstSegment < 0) return playlist;

  const header = source.slice(0, firstSegment);
  const blocks: SegmentBlock[] = [];
  for (let index = firstSegment; index < source.length;) {
    if (!source[index].startsWith("#EXTINF:")) {
      index += 1;
      continue;
    }
    const lines = [source[index]];
    const durationSeconds = Number.parseFloat(source[index].slice("#EXTINF:".length)) || 0;
    let startsAt: number | null = null;
    index += 1;
    while (index < source.length) {
      const line = source[index];
      lines.push(line);
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
        const parsed = Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length));
        startsAt = Number.isFinite(parsed) ? parsed : null;
      }
      index += 1;
      if (line && !line.startsWith("#")) break;
    }
    blocks.push({ lines, startsAt, durationSeconds });
  }
  if (!blocks.length || blocks.every((block) => block.startsAt === null)) return playlist;

  let selected = blocks.findIndex((block) =>
    block.startsAt !== null && block.startsAt + block.durationSeconds * 1000 >= startAtMs,
  );
  if (selected < 0) selected = blocks.length - 1;
  const originalSequenceLine = header.find((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
  const originalSequence = originalSequenceLine ? Number.parseInt(originalSequenceLine.split(":", 2)[1], 10) : 0;
  const nextHeader = header.map((line) =>
    line.startsWith("#EXT-X-MEDIA-SEQUENCE:") ? `#EXT-X-MEDIA-SEQUENCE:${originalSequence + selected}` : line,
  );
  if (!nextHeader.some((line) => line.startsWith("#EXT-X-START:"))) {
    nextHeader.push("#EXT-X-START:TIME-OFFSET=0,PRECISE=NO");
  }
  return [...nextHeader, ...blocks.slice(selected).flatMap((block) => block.lines), ""].join("\n");
}
