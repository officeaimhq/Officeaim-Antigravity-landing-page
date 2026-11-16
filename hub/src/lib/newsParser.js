/**
 * Shared OfficeAIM Newsroom parser, metadata filter, reading-time calculator,
 * and YouTube duration formatter.
 */

const LEGACY_META_LINE_RE = /^(?:Reading\s*time|Estimated\s*Video|Primary\s*target\s*keyword|Matching\s*PAA\s*questions?)\s*:/i;
const DECORATIVE_RULE_RE = /^\s*[=-](?:[\s=-]*[=-])?\s*$/;

/**
 * Removes legacy email metadata lines and decorative divider lines (= or -)
 * without altering published database records.
 */
export function stripLegacyNewsMetadata(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    return rawText
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter((line) => {
            const trimmed = line.trim();
            if (!trimmed) return true;
            if (LEGACY_META_LINE_RE.test(trimmed)) return false;
            if (DECORATIVE_RULE_RE.test(trimmed)) return false;
            return true;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Extracts title, category, youtube_url, and cleaned body from pasted text.
 * Supports <<<TRANSMISSION START>>> ... <<<TRANSMISSION END>>> markers
 * as well as legacy Make emails without markers.
 */
export function parseTransmissionMarkdown(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const text = rawText.replace(/\r\n/g, '\n').trim();
    if (!text) return null;

    const startMarker = '<<<TRANSMISSION START>>>';
    const endMarker = '<<<TRANSMISSION END>>>';
    const startIdx = text.indexOf(startMarker);
    const endIdx = text.indexOf(endMarker);

    let title = '';
    let category = '';
    let youtube_url = '';
    let description = '';

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        // Marker mode: use ONLY content between markers, ignore everything else
        const block = text.slice(startIdx + startMarker.length, endIdx).trim();
        const rawLines = block.split('\n');

        // Find first non-empty line as title
        let titleLineIndex = -1;
        for (let i = 0; i < rawLines.length; i++) {
            const trimmed = rawLines[i].trim();
            if (trimmed) {
                titleLineIndex = i;
                title = trimmed
                    .replace(/^(?:SEO\s*title|Title):\s*/i, '')
                    .replace(/^[#*_\s]+/, '')
                    .replace(/[#*_\s]+$/, '')
                    .trim();
                break;
            }
        }

        // Extract YouTube URL if present inside the block
        const ytMatch = block.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s)]*)/i);
        if (ytMatch) {
            youtube_url = ytMatch[0];
        }

        // Category extraction from block
        const categoryMatch = block.match(/(?:Category|Categor[ií]a):\s*([^\n\r]+)/i);
        if (categoryMatch && categoryMatch[1].trim()) {
            category = categoryMatch[1].trim().replace(/^[*_]+|[*_]+$/g, '');
        } else {
            category = inferCategory(block);
        }

        // Remaining lines (excluding the title line) become Content and summary
        const bodyLines = titleLineIndex >= 0 ? rawLines.slice(titleLineIndex + 1) : rawLines;
        const normalizedTitle = title.toLowerCase();
        const filteredBody = bodyLines
            .filter((line) => {
                const t = line.trim();
                if (!t) return true;
                if (normalizedTitle && t.toLowerCase() === normalizedTitle) return false;
                if (/^(?:Category|Categor[ií]a):\s*/i.test(t)) return false;
                if (/\[INSERT_[A-Z0-9_]+_EMBED_HERE\]/i.test(t)) return false;
                return true;
            })
            .join('\n');

        description = stripLegacyNewsMetadata(filteredBody);
        return { title, category, youtube_url, description };
    }

    // Legacy mode (no markers)
    const ytMatch = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s)]*)/i);
    if (ytMatch) {
        youtube_url = ytMatch[0];
    }

    const seoTitleMatch = text.match(/SEO\s*title:\s*([^\n\r]+?)(?:\s*Suggested\s*slug:|\s*Meta\s*description:|\n|$)/i);
    const explicitTitleMatch = text.match(/^Title:\s*([^\n\r]+)/im);
    const h1Match = text.match(/^#\s+([^\n\r]+)/m);

    if (seoTitleMatch && seoTitleMatch[1].trim()) {
        title = seoTitleMatch[1].trim();
    } else if (explicitTitleMatch && explicitTitleMatch[1].trim()) {
        title = explicitTitleMatch[1].trim();
    } else if (h1Match && h1Match[1].trim()) {
        title = h1Match[1].trim();
    } else {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
            title = lines[0].replace(/^[#*_\s]+/, '').replace(/[#*_\s]+$/, '');
        }
    }

    const categoryMatch = text.match(/(?:Category|Categor[ií]a):\s*([^\n\r]+)/i);
    if (categoryMatch && categoryMatch[1].trim()) {
        category = categoryMatch[1].trim().replace(/^[*_]+|[*_]+$/g, '');
    } else {
        category = inferCategory(text);
    }

    let cleanDescription = text;
    cleanDescription = cleanDescription.replace(/^\s*=+\s*NOTEBOOKLM[\s\S]*$/im, '');
    cleanDescription = cleanDescription.replace(/^(?:SEO\s*title|Title):\s*[^\n\r]+(?:\r?\n)?/im, '');
    cleanDescription = cleanDescription.replace(/^#\s+[^\n\r]+(?:\r?\n)?/m, '');
    cleanDescription = cleanDescription.replace(/^(?:Category|Categor[ií]a):\s*[^\n\r]+(?:\r?\n)?/im, '');
    cleanDescription = cleanDescription.replace(/^(?:Date|Fecha):\s*[^\n\r]+(?:\r?\n)?/im, '');
    cleanDescription = cleanDescription.replace(/^(?:Officeaim Newsroom metadata|Metadata):\s*[^\n\r]+(?:\r?\n)?/im, '');
    cleanDescription = cleanDescription.replace(/\[INSERT_[A-Z0-9_]+_EMBED_HERE\]/gi, '');
    cleanDescription = stripLegacyNewsMetadata(cleanDescription);
    cleanDescription = cleanDescription.replace(/^[\s\r\n\-=_]+/, '').trim();

    if (title) {
        const descLines = cleanDescription.split('\n');
        while (descLines.length > 0 && !descLines[0].trim()) {
            descLines.shift();
        }
        if (descLines.length > 0) {
            const firstClean = descLines[0].trim().replace(/^[#*_\s]+/, '').replace(/[#*_\s]+$/, '');
            if (firstClean.toLowerCase() === title.toLowerCase()) {
                descLines.shift();
                cleanDescription = descLines.join('\n').trim();
            }
        }
    }

    description = cleanDescription;

    return { title, category, youtube_url, description };
}

function inferCategory(text) {
    const lower = text.toLowerCase();
    if (lower.includes('video') || lower.includes('hyperframes') || lower.includes('animat')) {
        return 'Generative AI';
    }
    if (lower.includes('visual') || lower.includes('image') || lower.includes('banana')) {
        return 'Generative Visuals';
    }
    if (lower.includes('agent') || lower.includes('openbot') || lower.includes('autonomous')) {
        return 'Autonomous Agents';
    }
    if (lower.includes('prompt') || lower.includes('meta-prompt')) {
        return 'Prompt Architecture';
    }
    return 'AI Workflow Strategy';
}

/**
 * Calculates reading time in minutes (words / 200, rounded up, min 1).
 * Excludes "Sources & highlights", "Sources and highlights", and "Explore OfficeAIM" blocks.
 */
export function calculateReadingTimeMinutes(rawText) {
    const cleaned = stripLegacyNewsMetadata(rawText);
    if (!cleaned) return 1;

    const lines = cleaned.split('\n');
    const bodyLines = [];
    let inExcludedBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();
        const headingNormalized = trimmed.replace(/^#{1,6}\s*/, '').replace(/\*\*/g, '').trim();

        if (/^(?:sources\s*(?:&|and)\s*highlights|explore\s+officeaim)\b/i.test(headingNormalized)) {
            inExcludedBlock = true;
            continue;
        }

        if (inExcludedBlock && /^#{1,3}\s+/.test(trimmed)) {
            inExcludedBlock = false;
        }

        if (!inExcludedBlock && trimmed) {
            bodyLines.push(trimmed);
        }
    }

    const plainText = bodyLines
        .join(' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[#*_`>]/g, ' ')
        .trim();

    if (!plainText) return 1;
    const words = plainText.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
}

/**
 * Formats video duration in seconds as "Video: X min Y s".
 * Returns empty string if duration is null/undefined/invalid.
 */
export function formatVideoDuration(seconds) {
    if (seconds === null || seconds === undefined) return '';
    const num = Number(seconds);
    if (!Number.isFinite(num) || num <= 0) return '';

    const total = Math.round(num);
    const mins = Math.floor(total / 60);
    const secs = total % 60;

    if (mins > 0 && secs > 0) return `Video: ${mins} min ${secs} s`;
    if (mins > 0) return `Video: ${mins} min`;
    return `Video: ${secs} s`;
}
