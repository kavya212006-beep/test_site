/**
 * Universal Subtitle Engine for FreeAutoCaption
 * Full support for SRT, VTT, ASS/SSA, SUB, TXT, and JSON.
 */

export interface SubtitleCue {
  id: number | string;
  start: number; // in seconds
  end: number;   // in seconds
  text: string;
  speaker?: string;
  words?: { word: string; start: number; end: number }[];
}

/**
 * Parses time format HH:MM:SS,mmm or HH:MM:SS.mmm or MM:SS.mmm into total seconds
 */
export function parseTime(timeStr: string): number {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace(',', '.');
  const parts = cleaned.split(':');
  
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  } else {
    return parseFloat(cleaned) || 0;
  }
}

/**
 * Formats seconds into SRT timestamp HH:MM:SS,mmm
 */
export function formatTimeSRT(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/**
 * Formats seconds into WebVTT timestamp HH:MM:SS.mmm
 */
export function formatTimeVTT(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.floor((safeSeconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

/**
 * Formats seconds into ASS timestamp H:MM:SS.cc (centiseconds)
 */
export function formatTimeASS(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const centiseconds = Math.floor(((safeSeconds % 1) * 1000) / 10);

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

/**
 * Parses SRT subtitle text into structured SubtitleCue array
 */
export function parseSRT(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = normalized.split(/\n\n+/);
  const cues: SubtitleCue[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n');
    if (lines.length < 2) continue;

    let timeLineIdx = 0;
    // If first line is a numeric sequence id, time line is line 1
    if (/^\d+$/.test(lines[0].trim()) && lines.length >= 2) {
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx];
    const match = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{1,3})/);
    if (!match) continue;

    const start = parseTime(match[1]);
    const end = parseTime(match[2]);
    const textLines = lines.slice(timeLineIdx + 1).filter(l => l.trim().length > 0);
    const rawText = textLines.join('\n').replace(/<[^>]*>/g, '').trim();

    if (rawText) {
      cues.push({
        id: cues.length + 1,
        start,
        end,
        text: rawText,
      });
    }
  }

  return cues;
}

/**
 * Parses WebVTT subtitle text
 */
export function parseVTT(content: string): SubtitleCue[] {
  const normalized = content.replace(/^WEBVTT[^\n]*\n+/i, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = normalized.split(/\n\n+/);
  const cues: SubtitleCue[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n');
    if (lines.length === 0) continue;

    // Filter out NOTE blocks
    if (lines[0].startsWith('NOTE') || lines[0].startsWith('STYLE')) continue;

    let timeLineIdx = 0;
    if (!lines[0].includes('-->') && lines.length > 1 && lines[1].includes('-->')) {
      timeLineIdx = 1;
    }

    const timeLine = lines[timeLineIdx] || '';
    const match = timeLine.match(/(\d{1,2}:)?(\d{2}:\d{2}[,\.]\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{2}:\d{2}[,\.]\d{1,3})/);
    if (!match) continue;

    const parts = timeLine.split('-->');
    const startStr = parts[0].trim();
    const endStr = parts[1].trim().split(' ')[0]; // ignore cue settings like align:start

    const start = parseTime(startStr);
    const end = parseTime(endStr);
    const textLines = lines.slice(timeLineIdx + 1).filter(l => l.trim().length > 0);
    const rawText = textLines.join('\n').replace(/<[^>]*>/g, '').trim();

    if (rawText) {
      cues.push({
        id: cues.length + 1,
        start,
        end,
        text: rawText,
      });
    }
  }

  return cues;
}

/**
 * Parses Advanced SubStation Alpha (.ass / .ssa) subtitle text
 */
export function parseASS(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const cues: SubtitleCue[] = [];
  let inEvents = false;
  let formatKeys: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === '[events]') {
      inEvents = true;
      continue;
    }
    if (trimmed.startsWith('[') && inEvents) {
      break; // End of Events section
    }
    if (!inEvents) continue;

    if (trimmed.toLowerCase().startsWith('format:')) {
      formatKeys = trimmed.substring(7).split(',').map(k => k.trim().toLowerCase());
      continue;
    }

    if (trimmed.toLowerCase().startsWith('dialogue:')) {
      const valueStr = trimmed.substring(9);
      const parts = valueStr.split(',');
      if (formatKeys.length > 0 && parts.length >= formatKeys.length) {
        const startIdx = formatKeys.indexOf('start');
        const endIdx = formatKeys.indexOf('end');
        const textIdx = formatKeys.indexOf('text');

        if (startIdx !== -1 && endIdx !== -1) {
          const start = parseTime(parts[startIdx]);
          const end = parseTime(parts[endIdx]);
          // Text is everything from textIdx to the end (may contain commas)
          const textPart = parts.slice(textIdx !== -1 ? textIdx : formatKeys.length - 1).join(',');
          // Remove ASS override tags like {\b1} or {\an8}
          const cleanText = textPart.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim();

          if (cleanText) {
            cues.push({
              id: cues.length + 1,
              start,
              end,
              text: cleanText,
            });
          }
        }
      }
    }
  }

  return cues;
}

/**
 * Universal auto-detection parser
 */
export function parseSubtitleText(content: string, filename = ''): SubtitleCue[] {
  const lowerName = filename.toLowerCase();
  const lowerContent = content.slice(0, 1000).toLowerCase();

  if (lowerName.endsWith('.ass') || lowerName.endsWith('.ssa') || lowerContent.includes('[script info]') || lowerContent.includes('[events]')) {
    return parseASS(content);
  }

  if (lowerName.endsWith('.vtt') || lowerContent.includes('webvtt')) {
    return parseVTT(content);
  }

  if (lowerName.endsWith('.json') || (content.trim().startsWith('{') || content.trim().startsWith('['))) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed.map((item, idx) => ({
          id: item.id || idx + 1,
          start: typeof item.start === 'number' ? item.start : parseTime(item.start || '0'),
          end: typeof item.end === 'number' ? item.end : parseTime(item.end || '0'),
          text: item.text || item.content || '',
          words: item.words,
        })).filter(c => c.text);
      } else if (parsed.segments && Array.isArray(parsed.segments)) {
        return parsed.segments.map((item: any, idx: number) => ({
          id: idx + 1,
          start: item.start || 0,
          end: item.end || 0,
          text: (item.text || '').trim(),
          words: item.words,
        }));
      }
    } catch {
      // Fallback to SRT if JSON parsing fails
    }
  }

  // Default to SRT parser
  const srtResult = parseSRT(content);
  if (srtResult.length > 0) return srtResult;

  // Fallback: parse plain text lines with estimated duration
  const rawLines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let currentTime = 0;
  return rawLines.map((line, idx) => {
    const wordCount = line.split(/\s+/).length;
    const duration = Math.max(1.8, wordCount * 0.35);
    const cue: SubtitleCue = {
      id: idx + 1,
      start: currentTime,
      end: currentTime + duration,
      text: line,
    };
    currentTime += duration + 0.2;
    return cue;
  });
}

/**
 * Serializes SubtitleCue array to SRT string
 */
export function serializeToSRT(cues: SubtitleCue[]): string {
  return cues
    .map((cue, idx) => {
      return `${idx + 1}\n${formatTimeSRT(cue.start)} --> ${formatTimeSRT(cue.end)}\n${cue.text}\n`;
    })
    .join('\n');
}

/**
 * Serializes SubtitleCue array to WebVTT string
 */
export function serializeToVTT(cues: SubtitleCue[]): string {
  const body = cues
    .map((cue, idx) => {
      return `${idx + 1}\n${formatTimeVTT(cue.start)} --> ${formatTimeVTT(cue.end)}\n${cue.text}\n`;
    })
    .join('\n');
  return `WEBVTT - Generated by FreeAutoCaption.com\n\n${body}`;
}

/**
 * Serializes SubtitleCue array to ASS (Advanced SubStation Alpha) string
 */
export function serializeToASS(cues: SubtitleCue[], title = 'FreeAutoCaption Subtitles'): string {
  const header = `[Script Info]
; Script generated by FreeAutoCaption.com
Title: ${title}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Inter,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,20,20,40,1
Style: Hormozi,Outfit,64,&H0000FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,5,2,2,20,20,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

  const events = cues
    .map(cue => {
      const formattedText = cue.text.replace(/\n/g, '\\N');
      return `Dialogue: 0,${formatTimeASS(cue.start)},${formatTimeASS(cue.end)},Default,,0,0,0,,${formattedText}`;
    })
    .join('\n');

  return `${header}${events}\n`;
}

/**
 * Serializes SubtitleCue array to plain TXT transcript
 */
export function serializeToTXT(cues: SubtitleCue[]): string {
  return cues.map(c => c.text).join('\n\n');
}

/**
 * Serializes SubtitleCue array to JSON format
 */
export function serializeToJSON(cues: SubtitleCue[]): string {
  return JSON.stringify(cues, null, 2);
}

/**
 * Shifts all cues by offset in milliseconds (positive = delay, negative = advance)
 */
export function shiftSubtitleTimings(cues: SubtitleCue[], offsetMs: number): SubtitleCue[] {
  const offsetSec = offsetMs / 1000;
  return cues.map(c => ({
    ...c,
    start: Math.max(0, c.start + offsetSec),
    end: Math.max(0.1, c.end + offsetSec),
    words: c.words?.map(w => ({
      ...w,
      start: Math.max(0, w.start + offsetSec),
      end: Math.max(0.1, w.end + offsetSec),
    })),
  }));
}

/**
 * Stretches or compresses timing (useful for 24fps vs 25fps drift or speed drift)
 */
export function stretchSubtitleTimings(cues: SubtitleCue[], stretchFactor: number): SubtitleCue[] {
  if (stretchFactor <= 0) return cues;
  return cues.map(c => ({
    ...c,
    start: c.start * stretchFactor,
    end: c.end * stretchFactor,
    words: c.words?.map(w => ({
      ...w,
      start: w.start * stretchFactor,
      end: w.end * stretchFactor,
    })),
  }));
}

/**
 * Merges two subtitle arrays with optional delay offset
 */
export function mergeSubtitleFiles(cuesA: SubtitleCue[], cuesB: SubtitleCue[], offsetSeconds = 0): SubtitleCue[] {
  const shiftedB = cuesB.map(c => ({
    ...c,
    start: c.start + offsetSeconds,
    end: c.end + offsetSeconds,
  }));
  const merged = [...cuesA, ...shiftedB].sort((a, b) => a.start - b.start);
  return merged.map((c, idx) => ({ ...c, id: idx + 1 }));
}
