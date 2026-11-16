// Netlify Function: /.netlify/functions/youtube-duration
// Securely fetches real YouTube video duration (ISO 8601 -> seconds)
// Requires an authenticated Supabase admin/superadmin session and a strict 11-char YouTube ID.

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function parseIso8601DurationToSeconds(isoDuration) {
    if (!isoDuration || typeof isoDuration !== 'string') return null;
    const match = isoDuration.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (!match) return null;

    const days = Number(match[1] || 0);
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    const seconds = Number(match[4] || 0);
    const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) && total > 0 ? total : null;
}

async function verifyAdminSession(authHeader) {
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        return { ok: false, status: 401, error: 'Unauthorized: valid session token required.' };
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        return { ok: false, status: 401, error: 'Unauthorized: empty session token.' };
    }

    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !supabaseAnonKey) {
        return { ok: false, status: 500, error: 'Server auth configuration missing.' };
    }

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: 'GET',
        headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`,
        },
    });
    if (!userRes.ok) {
        return { ok: false, status: 401, error: 'Unauthorized: invalid or expired session.' };
    }

    const user = await userRes.json().catch(() => null);
    if (!user?.id) {
        return { ok: false, status: 401, error: 'Unauthorized: invalid user session.' };
    }

    const profileRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
        {
            method: 'GET',
            headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${token}`,
            },
        }
    );

    if (!profileRes.ok) {
        return { ok: false, status: 403, error: 'Forbidden: unable to verify administrator role.' };
    }

    const profiles = await profileRes.json().catch(() => []);
    const role = profiles?.[0]?.role;
    if (role !== 'admin' && role !== 'superadmin') {
        return { ok: false, status: 403, error: 'Forbidden: administrator session required.' };
    }

    return { ok: true, userId: user.id, role };
}

exports.handler = async (event) => {
    const jsonHeaders = { 'Content-Type': 'application/json' };

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: jsonHeaders,
            body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
        };
    }

    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const authCheck = await verifyAdminSession(authHeader);
    if (!authCheck.ok) {
        return {
            statusCode: authCheck.status,
            headers: jsonHeaders,
            body: JSON.stringify({ error: authCheck.error }),
        };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return {
            statusCode: 400,
            headers: jsonHeaders,
            body: JSON.stringify({ error: 'Invalid JSON request body.' }),
        };
    }

    const { videoId } = body || {};
    if (typeof videoId !== 'string' || !YOUTUBE_ID_RE.test(videoId)) {
        return {
            statusCode: 400,
            headers: jsonHeaders,
            body: JSON.stringify({
                error: 'Invalid videoId. Expected an 11-character YouTube ID (letters, numbers, - or _).',
            }),
        };
    }

    const checkedAt = new Date().toISOString();
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    if (!youtubeApiKey) {
        console.warn('[youtube-duration] YOUTUBE_API_KEY is not configured; returning null duration.');
        return {
            statusCode: 200,
            headers: jsonHeaders,
            body: JSON.stringify({ videoId, durationSeconds: null, checkedAt }),
        };
    }

    try {
        const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(youtubeApiKey)}`;
        const ytRes = await fetch(apiUrl);
        if (!ytRes.ok) {
            console.warn('[youtube-duration] YouTube API returned status:', ytRes.status);
            return {
                statusCode: 200,
                headers: jsonHeaders,
                body: JSON.stringify({ videoId, durationSeconds: null, checkedAt }),
            };
        }

        const ytData = await ytRes.json().catch(() => ({}));
        const isoDuration = ytData?.items?.[0]?.contentDetails?.duration || null;
        const durationSeconds = parseIso8601DurationToSeconds(isoDuration);

        return {
            statusCode: 200,
            headers: jsonHeaders,
            body: JSON.stringify({ videoId, durationSeconds, checkedAt }),
        };
    } catch (err) {
        console.warn('[youtube-duration] Failed to query YouTube API:', err?.message || 'unknown error');
        return {
            statusCode: 200,
            headers: jsonHeaders,
            body: JSON.stringify({ videoId, durationSeconds: null, checkedAt }),
        };
    }
};
